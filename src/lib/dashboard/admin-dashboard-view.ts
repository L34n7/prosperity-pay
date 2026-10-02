import { ensureInitialPlatformAdmin, requireUser } from "@/lib/auth/require-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { isHiddenTestPayment } from "@/lib/payments/payment-visibility";

export async function getAdminDashboardView() {
  const { user, supabase } = await requireUser();
  const authorized = await ensureInitialPlatformAdmin(user.id);
  if (!authorized) throw new Error("Acesso administrativo necessário.");

  const { data: totalsRows, error: totalsError } = await supabase.rpc(
    "get_platform_dashboard_totals",
  );
  if (totalsError) throw totalsError;

  const admin = createAdminClient();
  const { data: payments, error: paymentsError } = await admin
    .from("payments")
    .select(
      "id,order_id,status,external_payment_id,external_reference,gross_amount_cents,provider_fee_amount_cents,created_at,paid_at,raw_provider_data,payment_transactions(transaction_type,status,occurred_at,created_at)",
    )
    .order("created_at", { ascending: false })
    .limit(500);
  if (paymentsError) throw paymentsError;

  const orderIds = Array.from(
    new Set((payments ?? []).map((payment) => payment.order_id)),
  );
  const { data: orders, error: ordersError } = orderIds.length
    ? await admin
        .from("orders")
        .select(
          "id,status,product_id,offer_id,customer_id,gross_amount_cents,settlement_model,created_at,paid_at,products(name),offers!orders_offer_id_fkey(name),financial_snapshots(gateway_fee_amount_cents,prosperity_fee_amount_cents,affiliate_amount_cents,coproducer_amount_cents,producer_amount_cents)",
        )
        .in("id", orderIds)
    : { data: [], error: null };
  if (ordersError) throw ordersError;

  const customerIds = Array.from(
    new Set((orders ?? []).map((order) => order.customer_id).filter(Boolean)),
  );
  const { data: customers, error: customersError } = customerIds.length
    ? await admin
        .from("customers")
        .select("id,name,email")
        .in("id", customerIds)
    : { data: [], error: null };
  if (customersError) throw customersError;

  const customerMap = new Map(
    (customers ?? []).map((customer) => [
      customer.id,
      {
        ...customer,
        email: customer.email.endsWith(".invalid") ? "" : customer.email,
      },
    ]),
  );

  return {
    totals: totalsRows?.[0] ?? {
      sales_count: 0,
      volume_cents: 0,
      product_revenue_cents: 0,
      ticket_average_cents: 0,
      available_cents: 0,
      pending_cents: 0,
      withdrawals_cents: 0,
      prosperity_fee_cents: 0,
      affiliate_commission_cents: 0,
      accredited_commission_cents: 0,
      coproducer_commission_cents: 0,
      total_commission_cents: 0,
    },
    payments: (payments ?? []).filter((payment) => !isHiddenTestPayment(payment.raw_provider_data)),
    orders: (orders ?? []).map((order) => ({
      ...order,
      customers: customerMap.get(order.customer_id) ?? null,
      producer_net_cents: null as number | null,
    })),
  };
}
