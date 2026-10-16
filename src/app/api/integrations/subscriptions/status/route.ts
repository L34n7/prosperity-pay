import { NextResponse } from "next/server";
import {
  asObject,
  HttpError,
  jsonError,
  requiredString,
} from "@/lib/api/http";
import { requireSignedIntegrationRequest } from "@/lib/integrations/inbound-auth";
import { createAdminClient } from "@/lib/supabase/admin";

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

    const { data: subscription, error: subscriptionError } = await admin
      .from("subscriptions")
      .select(
        "id,product_id,customer_id,offer_id,status,billing_model,base_amount_cents,current_amount_cents,currency,current_period_start,current_period_end,next_due_at,cycle_number",
      )
      .eq("id", subscriptionId)
      .single();

    if (subscriptionError || !subscription) {
      throw subscriptionError ?? new HttpError(404, "Assinatura não encontrada.");
    }

    await ensureIntegrationOwnsProduct(integrationKey, subscription.product_id);

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
