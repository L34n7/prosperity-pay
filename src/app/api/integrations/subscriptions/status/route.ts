import { NextResponse } from "next/server";
import {
  asObject,
  HttpError,
  jsonError,
  requiredString,
} from "@/lib/api/http";
import { requireSignedIntegrationRequest } from "@/lib/integrations/inbound-auth";
import { dispatchPaymentIntegrationEventsSafe } from "@/lib/integrations/payment-events";
import { dispatchSubscriptionIntegrationEventSafe } from "@/lib/integrations/subscription-events";
import { createAdminClient } from "@/lib/supabase/admin";
import { synchronizePrepaidSubscriptionLifecycle } from "@/lib/subscriptions/lifecycle";

type AdminClient = ReturnType<typeof createAdminClient>;

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function periodEnd(
  start: Date,
  offer: { billing_interval: string | null; billing_interval_count: number | null },
) {
  const end = new Date(start);
  const count = Math.max(1, Number(offer.billing_interval_count || 1));

  if (offer.billing_interval === "week") {
    end.setUTCDate(end.getUTCDate() + count * 7);
  } else if (offer.billing_interval === "year") {
    end.setUTCFullYear(end.getUTCFullYear() + count);
  } else {
    end.setUTCMonth(end.getUTCMonth() + count);
  }

  return end;
}

async function ensureIntegrationOwnsProduct(
  integrationKey: string,
  productId: string,
) {
  const admin = createAdminClient();

  const { data: routes, error: routeError } = await admin
    .from("integration_webhook_routes")
    .select("offer_reference")
    .eq("integration", integrationKey)
    .eq("active", true);

  if (routeError) throw routeError;

  const references = (routes ?? [])
    .map((route) => String(route.offer_reference || "").trim())
    .filter(Boolean);

  if (!references.length) {
    throw new HttpError(
      403,
      "Esta integração não pode consultar assinaturas deste produto.",
    );
  }

  const { data: allowedOffer, error: allowedOfferError } = await admin
    .from("offers")
    .select("id")
    .eq("product_id", productId)
    .in("checkout_slug", references)
    .limit(1)
    .maybeSingle();

  if (allowedOfferError) throw allowedOfferError;
  if (!allowedOffer) {
    throw new HttpError(
      403,
      "Esta integração não pode consultar assinaturas deste produto.",
    );
  }
}

async function repararRenovacaoAprovadaPendente(
  admin: AdminClient,
  subscription: {
    id: string;
    current_period_end: string | null;
  },
) {
  const currentEndMs = subscription.current_period_end
    ? new Date(subscription.current_period_end).getTime()
    : Number.NaN;
  if (!Number.isFinite(currentEndMs)) {
    return { repaired: false as const };
  }

  const { data: orders, error: ordersError } = await admin
    .from("orders")
    .select("id,billing_reason,status,paid_at,offer_id,created_at")
    .eq("subscription_id", subscription.id)
    .eq("status", "paid")
    .order("paid_at", { ascending: false, nullsFirst: false })
    .limit(8);

  if (ordersError) throw ordersError;

  for (const order of orders ?? []) {
    const { data: payment, error: paymentError } = await admin
      .from("payments")
      .select("id,status,paid_at,raw_provider_data")
      .eq("order_id", order.id)
      .eq("status", "approved")
      .order("paid_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (paymentError) throw paymentError;
    if (!payment?.id || !payment.paid_at) continue;

    const paidAtMs = new Date(payment.paid_at).getTime();
    if (!Number.isFinite(paidAtMs)) continue;

    let dueAt = subscription.current_period_end;
    let billingReason = String(order.billing_reason || "");
    const raw = objectValue(payment.raw_provider_data);
    const manualExternal = String(raw.source || "") === "manual_external_sale";

    if (billingReason === "subscription_renewal") {
      const { data: session, error: sessionError } = await admin
        .from("subscription_checkout_sessions")
        .select("metadata")
        .eq("order_id", order.id)
        .maybeSingle();

      if (sessionError) throw sessionError;
      const metadata = objectValue(session?.metadata);
      if (typeof metadata.renewalDueAt === "string" && metadata.renewalDueAt) {
        dueAt = metadata.renewalDueAt;
      }

      const dueAtMs = dueAt ? new Date(dueAt).getTime() : Number.NaN;
      if (
        Number.isFinite(dueAtMs) &&
        currentEndMs > dueAtMs + 60_000
      ) {
        continue;
      }
    } else if (manualExternal && paidAtMs >= currentEndMs - 60_000) {
      const { error: orderUpdateError } = await admin
        .from("orders")
        .update({
          billing_reason: "subscription_renewal",
          updated_at: new Date().toISOString(),
        })
        .eq("id", order.id)
        .eq("subscription_id", subscription.id);

      if (orderUpdateError) throw orderUpdateError;
      billingReason = "subscription_renewal";
    } else {
      continue;
    }

    if (billingReason !== "subscription_renewal" || !dueAt) continue;

    const { data: existingClaim, error: claimLookupError } = await (admin as any)
      .from("subscription_renewal_payment_claims")
      .select("payment_id")
      .eq("subscription_id", subscription.id)
      .eq("due_at", dueAt)
      .maybeSingle();

    if (claimLookupError) throw claimLookupError;

    if (
      existingClaim?.payment_id &&
      String(existingClaim.payment_id) !== String(payment.id)
    ) {
      continue;
    }

    if (!existingClaim) {
      const { data: claimed, error: claimError } = await (admin as any).rpc(
        "claim_prepaid_subscription_renewal_payment",
        {
          target_subscription_id: subscription.id,
          target_payment_id: payment.id,
          target_due_at: dueAt,
        },
      );

      if (claimError) throw claimError;
      if (claimed !== true) continue;
    }

    const { data: offer, error: offerError } = await admin
      .from("offers")
      .select("billing_interval,billing_interval_count")
      .eq("id", order.offer_id)
      .single();

    if (offerError || !offer) {
      throw offerError ?? new Error("Oferta da renovação não encontrada.");
    }

    const start = new Date(Math.max(currentEndMs, paidAtMs));
    const end = periodEnd(start, offer);

    const { error: applyError } = await (admin as any).rpc(
      "apply_prepaid_subscription_renewal",
      {
        target_subscription_id: subscription.id,
        target_payment_id: payment.id,
        target_period_start: start.toISOString(),
        target_period_end: end.toISOString(),
      },
    );

    if (applyError) throw applyError;

    await Promise.all([
      dispatchPaymentIntegrationEventsSafe(admin, payment.id),
      dispatchSubscriptionIntegrationEventSafe(admin, order.id),
    ]);

    return {
      repaired: true as const,
      orderId: order.id,
      paymentId: payment.id,
    };
  }

  return { repaired: false as const };
}

async function loadSubscription(admin: AdminClient, subscriptionId: string) {
  const { data, error } = await admin
    .from("subscriptions")
    .select(
      "id,product_id,customer_id,offer_id,status,billing_model,base_amount_cents,current_amount_cents,currency,current_period_start,current_period_end,next_due_at,cycle_number",
    )
    .eq("id", subscriptionId)
    .single();

  if (error || !data) {
    throw error ?? new HttpError(404, "Assinatura não encontrada.");
  }

  return data;
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const { integrationKey } = await requireSignedIntegrationRequest(
      request,
      rawBody,
    );

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new HttpError(400, "JSON inválido.");
    }

    const body = asObject(parsed);
    const subscriptionId = requiredString(body, "subscriptionId", 80);
    const admin = createAdminClient();

    let subscription = await loadSubscription(admin, subscriptionId);
    await ensureIntegrationOwnsProduct(integrationKey, subscription.product_id);

    const repair = await repararRenovacaoAprovadaPendente(admin, subscription);
    if (repair.repaired) {
      subscription = await loadSubscription(admin, subscriptionId);
    }

    await synchronizePrepaidSubscriptionLifecycle(admin, {
      subscriptionIds: [subscriptionId],
    });
    subscription = await loadSubscription(admin, subscriptionId);

    const [offerResult, customerResult, itemsResult] = await Promise.all([
      admin
        .from("offers")
        .select("id,name,checkout_slug")
        .eq("id", subscription.offer_id)
        .single(),
      admin
        .from("customers")
        .select("id,name,email")
        .eq("id", subscription.customer_id)
        .single(),
      admin
        .from("subscription_items")
        .select(
          "id,item_type,code,description,unit_amount_cents,quantity,status,offer_id,addon_id",
        )
        .eq("subscription_id", subscriptionId)
        .eq("status", "active")
        .order("created_at"),
    ]);

    if (offerResult.error || !offerResult.data) {
      throw offerResult.error ?? new Error("Oferta da assinatura não encontrada.");
    }
    if (customerResult.error || !customerResult.data) {
      throw customerResult.error ?? new Error("Cliente da assinatura não encontrado.");
    }
    if (itemsResult.error) throw itemsResult.error;

    return NextResponse.json({
      ok: true,
      repaired: repair.repaired,
      subscription: {
        id: subscription.id,
        status: subscription.status,
        billing_model: subscription.billing_model,
        base_amount_cents: Number(subscription.base_amount_cents || 0),
        current_amount_cents: Number(subscription.current_amount_cents || 0),
        currency: subscription.currency,
        current_period_start: subscription.current_period_start,
        current_period_end: subscription.current_period_end,
        next_due_at: subscription.next_due_at,
        cycle_number: Number(subscription.cycle_number || 0),
        items: (itemsResult.data ?? []).map((item) => ({
          id: item.id,
          type: item.item_type,
          code: item.code,
          description: item.description,
          unit_amount_cents: Number(item.unit_amount_cents || 0),
          quantity: Number(item.quantity || 0),
          total_amount_cents:
            Number(item.unit_amount_cents || 0) * Number(item.quantity || 0),
          offer_id: item.offer_id,
          addon_id: item.addon_id,
        })),
      },
      offer: {
        id: offerResult.data.id,
        name: offerResult.data.name,
        checkout_slug: offerResult.data.checkout_slug,
        reference: offerResult.data.checkout_slug,
      },
      customer: customerResult.data,
    });
  } catch (error) {
    return jsonError(error);
  }
}
