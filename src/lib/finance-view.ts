import { requireUser } from "@/lib/auth/require-user";
import { expireStalePayments } from "@/lib/payments/expire-stale-payments";
import { isHiddenTestPayment } from "@/lib/payments/payment-visibility";
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
    { data: partnerPrograms, error: partnerProgramsError },
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
        "id,payment_id,commission_type,status,amount_cents,available_at,paid_at,reversed_at,created_at,payments!commissions_payment_id_fkey(orders!payments_order_id_fkey(product_id,products(name),offers!orders_offer_id_fkey(name)))",
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
      .select("program_id,partner_type,status")
      .eq("user_id", user.id),
    admin
      .from("affiliate_programs")
      .select("id,product_id"),
  ]);

  if (
    ordersError ||
    commissionsError ||
    balanceError ||
    withdrawalsError ||
    partnerMembershipsError ||
    partnerProgramsError
  ) {
    throw (
      ordersError ||
      commissionsError ||
      balanceError ||
      withdrawalsError ||
      partnerMembershipsError ||
      partnerProgramsError
    );
  }

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

  const [paymentsResult, customersResult, producerLedgerResult, productsCountResult, participantCountResult] = await Promise.all([
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
    admin
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("producer_id", user.id),
    admin
      .from("product_participants")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("active", true),
  ]);

  if (
    paymentsResult.error ||
    customersResult.error ||
    producerLedgerResult.error ||
    productsCountResult.error ||
    participantCountResult.error
  ) {
    throw (
      paymentsResult.error ||
      customersResult.error ||
      producerLedgerResult.error ||
      productsCountResult.error ||
      participantCountResult.error
    );
  }

  const paymentIds = (paymentsResult.data ?? []).map((payment) => payment.id);

  const [outgoingCommissionsResult, attributionsResult] = await Promise.all([
    paymentIds.length
      ? admin
          .from("commissions")
          .select("id,payment_id,beneficiary_user_id,commission_type,status,amount_cents,available_at,paid_at,reversed_at,created_at")
          .in("payment_id", paymentIds)
      : Promise.resolve({ data: [], error: null }),
    orderIds.length
      ? admin
          .from("affiliate_attributions")
          .select("order_id,affiliate_membership_id")
          .in("order_id", orderIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (outgoingCommissionsResult.error || attributionsResult.error) {
    throw outgoingCommissionsResult.error || attributionsResult.error;
  }

  const outgoingMembershipIds = Array.from(
    new Set(
      (attributionsResult.data ?? [])
        .map((item) => item.affiliate_membership_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const outgoingMembershipsResult = outgoingMembershipIds.length
    ? await admin
        .from("affiliate_memberships")
        .select("id,partner_type")
        .in("id", outgoingMembershipIds)
    : { data: [], error: null };

  if (outgoingMembershipsResult.error) throw outgoingMembershipsResult.error;

  const outgoingMembershipType = new Map(
    (outgoingMembershipsResult.data ?? []).map((membership) => [
      membership.id,
      membership.partner_type,
    ]),
  );
  const outgoingPartnerTypes = Object.fromEntries(
    (attributionsResult.data ?? [])
      .filter((item) => item.order_id)
      .map((item) => [
        item.order_id as string,
        item.affiliate_membership_id
          ? outgoingMembershipType.get(item.affiliate_membership_id) ?? "affiliate"
          : "affiliate",
      ]),
  );

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
    outgoingCommissions: outgoingCommissionsResult.data ?? [],
    outgoingPartnerTypes,
    partnerMemberships: partnerMemberships ?? [],
    partnerPrograms: partnerPrograms ?? [],
    hasProducts: Number(productsCountResult.count ?? 0) > 0,
    hasPartner:
      (partnerMemberships ?? []).some((membership) => membership.status === "active") ||
      Number(participantCountResult.count ?? 0) > 0 ||
      (commissions ?? []).some(
        (commission) =>
          commission.status !== "cancelled" && commission.status !== "reversed",
      ),
    partnerRoles: {
      affiliate: (partnerMemberships ?? []).some(
        (membership) =>
          membership.status === "active" && membership.partner_type === "affiliate",
      ),
      accredited: (partnerMemberships ?? []).some(
        (membership) =>
          membership.status === "active" && membership.partner_type === "accredited",
      ),
      coproducer:
        Number(participantCountResult.count ?? 0) > 0 ||
        (commissions ?? []).some(
          (commission) =>
            commission.commission_type === "coproducer" &&
            commission.status !== "cancelled" &&
            commission.status !== "reversed",
        ),
    },
    balance: balance ?? {
      pending_cents: 0,
      available_cents: 0,
      withdrawing_cents: 0,
      total_received_cents: 0,
    },
    withdrawals: withdrawals ?? [],
    payments: (paymentsResult.data ?? []).filter((payment) => !isHiddenTestPayment(payment.raw_provider_data)),
  };
}
