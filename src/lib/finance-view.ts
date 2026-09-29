import { requireUser } from "@/lib/auth/require-user";
import { expireStalePayments } from "@/lib/payments/expire-stale-payments";
import { createAdminClient } from "@/lib/supabase/admin";

export async function getFinanceView() {
  const { user, supabase } = await requireUser();
  const admin = createAdminClient();

  await expireStalePayments(admin, { producerId: user.id });

  const [
    { data: orders, error: ordersError },
    { data: commissions, error: commissionsError },
    { data: balance, error: balanceError },
    { data: withdrawals, error: withdrawalsError },
    { data: partnerMemberships, error: partnerMembershipsError },
  ] = await Promise.all([
    supabase
      .from("orders")
      .select(
        "id,status,product_id,offer_id,customer_id,gross_amount_cents,settlement_model,created_at,paid_at,products(name),offers!orders_offer_id_fkey(name),financial_snapshots(gateway_fee_amount_cents,prosperity_fee_amount_cents,affiliate_amount_cents,coproducer_amount_cents,producer_amount_cents)",
      )
      .eq("producer_id", user.id)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("commissions")
      .select(
        "id,payment_id,commission_type,status,amount_cents,available_at,created_at,payments!commissions_payment_id_fkey(orders!payments_order_id_fkey(product_id,products(name),offers!orders_offer_id_fkey(name)))",
      )
      .eq("beneficiary_user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase.from("user_balance_summary").select("*").eq("user_id", user.id).maybeSingle(),
    supabase
      .from("withdrawals")
      .select("id,status,amount_cents,created_at,payout_key_last4")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(100),
    admin
      .from("affiliate_memberships")
      .select("program_id,partner_type")
      .eq("user_id", user.id),
  ]);

  if (
    ordersError ||
    commissionsError ||
    balanceError ||
    withdrawalsError ||
    partnerMembershipsError
  ) {
    throw (
      ordersError ||
      commissionsError ||
      balanceError ||
      withdrawalsError ||
      partnerMembershipsError
    );
  }

  const partnerProgramIds = Array.from(
    new Set((partnerMemberships ?? []).map((membership) => membership.program_id)),
  );
  const partnerProgramsResult = partnerProgramIds.length
    ? await admin
        .from("affiliate_programs")
        .select("id,product_id")
        .in("id", partnerProgramIds)
    : { data: [], error: null };

  if (partnerProgramsResult.error) throw partnerProgramsResult.error;

  const productIdByProgram = new Map(
    (partnerProgramsResult.data ?? []).map((program) => [
      program.id,
      program.product_id,
    ]),
  );
  const partnerTypeByProduct = new Map(
    (partnerMemberships ?? [])
      .map((membership) => [
        productIdByProgram.get(membership.program_id) ?? null,
        membership.partner_type,
      ] as const)
      .filter(
        (entry): entry is readonly [string, "affiliate" | "accredited"] =>
          Boolean(entry[0]),
      ),
  );

  const commissionTotals = (commissions ?? []).reduce(
    (totals, commission) => {
      if (commission.commission_type === "coproducer") {
        totals.coproducer_cents += Number(commission.amount_cents);
        return totals;
      }

      if (commission.commission_type === "affiliate") {
        const productId = commission.payments?.orders?.product_id ?? null;
        if (productId && partnerTypeByProduct.get(productId) === "accredited") {
          totals.accredited_cents += Number(commission.amount_cents);
        } else {
          totals.affiliate_cents += Number(commission.amount_cents);
        }
      }

      return totals;
    },
    { affiliate_cents: 0, accredited_cents: 0, coproducer_cents: 0 },
  );

  const safeOrders = orders ?? [];
  const orderIds = safeOrders.map((order) => order.id);
  const customerIds = Array.from(
    new Set(safeOrders.map((order) => order.customer_id).filter(Boolean)),
  );

  const { data: producerAccounts, error: producerAccountsError } = await admin
    .from("ledger_accounts")
    .select("id")
    .eq("user_id", user.id);

  if (producerAccountsError) throw producerAccountsError;

  const producerAccountIds = (producerAccounts ?? []).map((account) => account.id);

  const [paymentsResult, customersResult, producerLedgerResult] = await Promise.all([
    orderIds.length
      ? supabase
          .from("payments")
          .select(
            "id,order_id,status,external_payment_id,external_reference,gross_amount_cents,provider_fee_amount_cents,created_at,paid_at,raw_provider_data,payment_transactions(transaction_type,status,occurred_at,created_at)",
          )
          .in("order_id", orderIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    customerIds.length
      ? admin.from("customers").select("id,name,email").in("id", customerIds)
      : Promise.resolve({ data: [], error: null }),
    orderIds.length && producerAccountIds.length
      ? admin
          .from("ledger_entries")
          .select("order_id,entry_type,amount_cents")
          .in("order_id", orderIds)
          .in("account_id", producerAccountIds)
          .eq("status", "posted")
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (paymentsResult.error || customersResult.error || producerLedgerResult.error) {
    throw paymentsResult.error || customersResult.error || producerLedgerResult.error;
  }

  const producerRevenueEntryTypes = new Set([
    "sale_credit",
    "gateway_fee",
    "refund",
    "chargeback",
    "adjustment",
  ]);
  const producerNetByOrder = new Map<string, number>();
  const ordersWithSaleCredit = new Set<string>();

  for (const entry of producerLedgerResult.data ?? []) {
    if (!entry.order_id || !producerRevenueEntryTypes.has(entry.entry_type)) continue;
    if (entry.entry_type === "sale_credit") ordersWithSaleCredit.add(entry.order_id);
    producerNetByOrder.set(
      entry.order_id,
      (producerNetByOrder.get(entry.order_id) ?? 0) + Number(entry.amount_cents ?? 0),
    );
  }

  const customerMap = new Map(
    (customersResult.data ?? []).map((customer) => [
      customer.id,
      {
        ...customer,
        email: customer.email.endsWith(".invalid") ? "" : customer.email,
      },
    ]),
  );

  return {
    orders: safeOrders.map((order) => ({
      ...order,
      customers: customerMap.get(order.customer_id) ?? null,
      producer_net_cents: ordersWithSaleCredit.has(order.id)
        ? producerNetByOrder.get(order.id) ?? 0
        : null,
    })),
    commissions: commissions ?? [],
    commissionTotals,
    balance: balance ?? {
      pending_cents: 0,
      available_cents: 0,
      withdrawing_cents: 0,
      total_received_cents: 0,
    },
    withdrawals: withdrawals ?? [],
    payments: paymentsResult.data ?? [],
  };
}
