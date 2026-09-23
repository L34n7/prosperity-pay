import { deliverIntegrationWebhook } from "@/lib/integrations/outbound-webhook";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";

type AdminClient = ReturnType<typeof createAdminClient>;

function eventType(reason: string) {
  if (reason === "subscription_initial") return "subscription.started";
  if (reason === "subscription_renewal") return "subscription.renewed";
  if (reason === "subscription_change") return "subscription.changed";
  return null;
}

export async function dispatchSubscriptionIntegrationEvent(
  admin: AdminClient,
  orderId: string,
) {
  const { data: order, error: orderError } = await admin.from("orders")
    .select("id,billing_reason,subscription_id,subscription_change_id,offer_id,product_id,customer_id")
    .eq("id", orderId)
    .single();
  if (orderError || !order) throw orderError ?? new Error("Pedido da assinatura não encontrado.");
  const type = eventType(order.billing_reason);
  if (!type || !order.subscription_id) return { sent: 0, reason: "not_subscription_event" as const };

  const [subscriptionResult, offerResult, productResult, customerResult, itemsResult] = await Promise.all([
    admin.from("subscriptions")
      .select("id,status,billing_model,base_amount_cents,current_amount_cents,currency,current_period_start,current_period_end,next_due_at,cycle_number,offer_id")
      .eq("id", order.subscription_id).single(),
    admin.from("offers").select("id,name,checkout_slug").eq("id", order.offer_id).single(),
    admin.from("products").select("id,name").eq("id", order.product_id).single(),
    admin.from("customers").select("id,name,email").eq("id", order.customer_id).single(),
    admin.from("subscription_items")
      .select("id,item_type,code,description,unit_amount_cents,quantity,status,offer_id,addon_id")
      .eq("subscription_id", order.subscription_id).eq("status", "active").order("created_at"),
  ]);
  if (subscriptionResult.error || !subscriptionResult.data) throw subscriptionResult.error ?? new Error("Assinatura não encontrada.");
  if (offerResult.error || !offerResult.data) throw offerResult.error ?? new Error("Oferta não encontrada.");
  if (productResult.error || !productResult.data) throw productResult.error ?? new Error("Produto não encontrado.");
  if (customerResult.error || !customerResult.data) throw customerResult.error ?? new Error("Cliente não encontrado.");
  if (itemsResult.error) throw itemsResult.error;

  const refs = new Set([offerResult.data.checkout_slug]);
  if (subscriptionResult.data.offer_id !== order.offer_id) {
    const { data: currentOffer } = await admin.from("offers").select("checkout_slug").eq("id", subscriptionResult.data.offer_id).maybeSingle();
    if (currentOffer?.checkout_slug) refs.add(currentOffer.checkout_slug);
  }
  const { data: routes, error: routesError } = await admin.from("integration_webhook_routes")
    .select("integration")
    .in("offer_reference", [...refs])
    .eq("active", true);
  if (routesError) throw routesError;

  let change: Record<string, unknown> | null = null;
  if (order.subscription_change_id) {
    const { data, error } = await admin.from("subscription_changes")
      .select("id,change_type,status,proration_amount_cents,current_amount_cents,quoted_target_amount_cents,applied_target_amount_cents,effective_mode,effective_at,paid_at,applied_at,quantity_before,quantity_after")
      .eq("id", order.subscription_change_id)
      .single();
    if (error) throw error;
    change = data;
  }

  const payload = {
    version: "2026-09-23",
    event: type,
    occurred_at: new Date().toISOString(),
    order: {
      id: order.id,
      billing_reason: order.billing_reason,
    },
    subscription: {
      ...subscriptionResult.data,
      items: (itemsResult.data ?? []).map(item => ({
        id: item.id,
        type: item.item_type,
        code: item.code,
        description: item.description,
        unit_amount_cents: Number(item.unit_amount_cents),
        quantity: Number(item.quantity),
        total_amount_cents: Number(item.unit_amount_cents) * Number(item.quantity),
        offer_id: item.offer_id,
        addon_id: item.addon_id,
      })),
    },
    change,
    offer: offerResult.data,
    product: productResult.data,
    customer: customerResult.data,
  } as unknown as Json;

  const integrations = [...new Set((routes ?? []).map(route => route.integration).filter(Boolean))];
  const results = [];
  for (const integrationKey of integrations) {
    try {
      const result = await deliverIntegrationWebhook({
        admin,
        integrationKey,
        subjectType: "subscription_order",
        subjectId: order.id,
        eventType: type,
        payload,
      });
      results.push({ integration: integrationKey, sent: result.sent === true });
    } catch (error) {
      console.error("[SUBSCRIPTION INTEGRATION WEBHOOK] Falha na entrega", {
        integrationKey,
        orderId: order.id,
        eventType: type,
        error: error instanceof Error ? error.message : String(error),
      });
      results.push({ integration: integrationKey, sent: false });
    }
  }
  return { sent: results.filter(item => item.sent).length, results };
}

export async function dispatchSubscriptionIntegrationEventSafe(admin: AdminClient, orderId: string) {
  try {
    return await dispatchSubscriptionIntegrationEvent(admin, orderId);
  } catch (error) {
    console.error("[SUBSCRIPTION INTEGRATION WEBHOOK] Falha ao preparar evento", {
      orderId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { sent: 0, error: true as const };
  }
}
