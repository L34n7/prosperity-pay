import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

const PENDING_PAYMENT_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const AUTOMATIC_DUE_PAYMENT_TIMEOUT_MS = 8 * 24 * 60 * 60 * 1000;

type AdminClient = SupabaseClient<Database>;

type Scope = {
  productId?: string;
  producerId?: string;
};

async function cancelPendingOrders(
  admin: AdminClient,
  orderIds: string[],
  statusDetail: string,
) {
  if (!orderIds.length) return [];

  const now = new Date().toISOString();
  const { data: stalePayments, error: paymentError } = await admin
    .from("payments")
    .update({
      status: "cancelled",
      status_detail: statusDetail,
    })
    .in("order_id", orderIds)
    .in("status", ["pending", "processing"])
    .is("paid_at", null)
    .select("id,order_id");

  if (paymentError) throw paymentError;

  const cancelledOrderIds = Array.from(
    new Set((stalePayments ?? []).map((payment) => payment.order_id)),
  );

  if (!cancelledOrderIds.length) return [];

  const { error: orderError } = await admin
    .from("orders")
    .update({
      status: "cancelled",
      cancelled_at: now,
    })
    .in("id", cancelledOrderIds)
    .eq("status", "pending_payment");

  if (orderError) throw orderError;

  const { error: subscriptionError } = await admin
    .from("subscriptions")
    .update({
      status: "cancelled",
      cancelled_at: now,
    })
    .in("order_id", cancelledOrderIds)
    .eq("status", "pending");

  if (subscriptionError) throw subscriptionError;

  return cancelledOrderIds;
}

export async function expireStalePayments(
  admin: AdminClient,
  scope: Scope = {},
) {
  let ordersQuery = admin
    .from("orders")
    .select("id,idempotency_key,created_at")
    .eq("status", "pending_payment")
    .order("created_at", { ascending: true })
    .limit(1000);

  if (scope.productId) ordersQuery = ordersQuery.eq("product_id", scope.productId);
  if (scope.producerId) ordersQuery = ordersQuery.eq("producer_id", scope.producerId);

  const { data: pendingOrders, error: pendingOrdersError } = await ordersQuery;
  if (pendingOrdersError) throw pendingOrdersError;

  const now = Date.now();
  const regularOrderIds: string[] = [];
  const automaticDueOrderIds: string[] = [];

  for (const order of pendingOrders ?? []) {
    const createdAt = new Date(order.created_at).getTime();
    if (!Number.isFinite(createdAt)) continue;

    const automaticDue = String(order.idempotency_key || "").startsWith(
      "automatic-due:",
    );

    const timeout = automaticDue
      ? AUTOMATIC_DUE_PAYMENT_TIMEOUT_MS
      : PENDING_PAYMENT_TIMEOUT_MS;

    if (now - createdAt < timeout) continue;

    if (automaticDue) automaticDueOrderIds.push(order.id);
    else regularOrderIds.push(order.id);
  }

  const [regularCancelled, automaticCancelled] = await Promise.all([
    cancelPendingOrders(admin, regularOrderIds, "expired_after_24h"),
    cancelPendingOrders(admin, automaticDueOrderIds, "expired_after_8d"),
  ]);

  return regularCancelled.length + automaticCancelled.length;
}

export const PENDING_PAYMENT_TIMEOUT_HOURS = 24;
export const AUTOMATIC_DUE_PAYMENT_TIMEOUT_HOURS = 24 * 8;
