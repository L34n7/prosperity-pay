import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

const PENDING_PAYMENT_TIMEOUT_MS = 24 * 60 * 60 * 1000;

type AdminClient = SupabaseClient<Database>;

type Scope = {
  productId?: string;
  producerId?: string;
};

export async function expireStalePayments(admin: AdminClient, scope: Scope = {}) {
  const cutoff = new Date(Date.now() - PENDING_PAYMENT_TIMEOUT_MS).toISOString();

  let ordersQuery = admin.from("orders")
    .select("id")
    .eq("status", "pending_payment")
    .lt("created_at", cutoff)
    .limit(1000);

  if (scope.productId) ordersQuery = ordersQuery.eq("product_id", scope.productId);
  if (scope.producerId) ordersQuery = ordersQuery.eq("producer_id", scope.producerId);

  const { data: staleOrders, error: staleOrdersError } = await ordersQuery;
  if (staleOrdersError) throw staleOrdersError;

  const orderIds = (staleOrders ?? []).map(order => order.id);
  if (!orderIds.length) return 0;

  const now = new Date().toISOString();
  const { data: stalePayments, error: paymentError } = await admin.from("payments")
    .update({
      status: "cancelled",
      status_detail: "expired_after_24h",
    })
    .in("order_id", orderIds)
    .in("status", ["pending", "processing"])
    .is("paid_at", null)
    .select("id,order_id");
  if (paymentError) throw paymentError;

  const cancelledOrderIds = Array.from(new Set((stalePayments ?? []).map(payment => payment.order_id)));
  if (!cancelledOrderIds.length) return 0;

  const { error: orderError } = await admin.from("orders")
    .update({
      status: "cancelled",
      cancelled_at: now,
    })
    .in("id", cancelledOrderIds)
    .eq("status", "pending_payment");
  if (orderError) throw orderError;

  return cancelledOrderIds.length;
}

export const PENDING_PAYMENT_TIMEOUT_HOURS = 24;
