import { NextResponse } from "next/server";
import { asObject, HttpError, jsonError, requiredString } from "@/lib/api/http";
import { requireSignedIntegrationRequest } from "@/lib/integrations/inbound-auth";
import { createAdminClient } from "@/lib/supabase/admin";

function positiveCents(value: unknown, field: string) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new HttpError(400, `${field} inválido.`);
  }
  return amount;
}

function nonNegativeInteger(value: unknown, field: string) {
  const amount = Number(value ?? 0);
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > 10_000) {
    throw new HttpError(400, `${field} inválido.`);
  }
  return amount;
}

async function ensureIntegrationOwnsProduct(
  admin: ReturnType<typeof createAdminClient>,
  integrationKey: string,
  productId: string,
) {
  const { data: routes, error: routeError } = await admin
    .from("integration_webhook_routes")
    .select("offer_reference")
    .eq("integration", integrationKey)
    .eq("active", true);

  if (routeError) throw routeError;

  const references = (routes ?? [])
    .map((route) => String(route.offer_reference || "").trim())
    .filter(Boolean);

  if (references.length === 0) {
    throw new HttpError(403, "Esta integração não pode reconciliar assinaturas deste produto.");
  }

  const { data: offer, error: offerError } = await admin
    .from("offers")
    .select("id")
    .eq("product_id", productId)
    .in("checkout_slug", references)
    .limit(1)
    .maybeSingle();

  if (offerError) throw offerError;
  if (!offer) {
    throw new HttpError(403, "Esta integração não pode reconciliar assinaturas deste produto.");
  }
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const { integrationKey } = await requireSignedIntegrationRequest(request, rawBody);

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new HttpError(400, "JSON inválido.");
    }

    const body = asObject(parsed);
    const subscriptionId = requiredString(body, "subscriptionId", 80);
    const offerReference = requiredString(body, "offerReference", 120).toLowerCase();
    const baseAmountCents = positiveCents(body.baseAmountCents, "Valor base");
    const whatsappQuantity = nonNegativeInteger(
      body.whatsappNumberQuantity,
      "Quantidade de números adicionais",
    );

    const admin = createAdminClient();

    const { data: subscription, error: subscriptionError } = await admin
      .from("subscriptions")
      .select("id,product_id,offer_id,status,billing_model,currency,metadata,current_period_start")
      .eq("id", subscriptionId)
      .single();

    if (subscriptionError || !subscription) {
      throw subscriptionError ?? new HttpError(404, "Assinatura não encontrada.");
    }

    if (subscription.billing_model !== "prepaid") {
      throw new HttpError(409, "Somente assinaturas pré-pagas podem ser reconciliadas.");
    }

    const metadata =
      subscription.metadata &&
      typeof subscription.metadata === "object" &&
      !Array.isArray(subscription.metadata)
        ? (subscription.metadata as Record<string, unknown>)
        : {};

    if (metadata.imported !== true || String(metadata.integration || "") !== integrationKey) {
      throw new HttpError(
        409,
        "A reconciliação é permitida somente para assinaturas legadas importadas por esta integração.",
      );
    }

    await ensureIntegrationOwnsProduct(admin, integrationKey, subscription.product_id);

    const { data: targetOffer, error: targetOfferError } = await admin
      .from("offers")
      .select("id,name,checkout_slug,product_id,currency,billing_type,status")
      .eq("product_id", subscription.product_id)
      .eq("checkout_slug", offerReference)
      .maybeSingle();

    if (targetOfferError) throw targetOfferError;
    if (!targetOffer) throw new HttpError(404, "Oferta base não encontrada.");
    if (targetOffer.status !== "active" || targetOffer.billing_type !== "recurring") {
      throw new HttpError(409, "A oferta base não está disponível para assinatura.");
    }
    if (targetOffer.currency !== subscription.currency) {
      throw new HttpError(409, "A moeda da oferta base é incompatível com a assinatura.");
    }

    const { data: activeItems, error: activeItemsError } = await admin
      .from("subscription_items")
      .select("id,item_type,addon_id,code,unit_amount_cents,quantity,status")
      .eq("subscription_id", subscriptionId)
      .eq("status", "active");

    if (activeItemsError) throw activeItemsError;

    const baseItem = (activeItems ?? []).find((item) => item.item_type === "base");
    const activatedAt =
      subscription.current_period_start || new Date().toISOString();

    if (baseItem) {
      const { error } = await admin
        .from("subscription_items")
        .update({
          offer_id: targetOffer.id,
          code: targetOffer.checkout_slug,
          description: targetOffer.name,
          unit_amount_cents: baseAmountCents,
          quantity: 1,
        })
        .eq("id", baseItem.id)
        .eq("subscription_id", subscriptionId);
      if (error) throw error;
    } else {
      const { error } = await admin.from("subscription_items").insert({
        subscription_id: subscriptionId,
        item_type: "base",
        offer_id: targetOffer.id,
        code: targetOffer.checkout_slug,
        description: targetOffer.name,
        unit_amount_cents: baseAmountCents,
        quantity: 1,
        status: "active",
        activated_at: activatedAt,
      });
      if (error) throw error;
    }

    const { data: whatsappAddon, error: whatsappAddonError } = await admin
      .from("product_addons")
      .select("id,code,name,unit_amount_cents,currency")
      .eq("product_id", subscription.product_id)
      .eq("code", "whatsapp_number")
      .maybeSingle();

    if (whatsappAddonError) throw whatsappAddonError;
    if (whatsappQuantity > 0 && !whatsappAddon) {
      throw new HttpError(409, "Adicional de número WhatsApp não configurado.");
    }

    const activeWhatsappItem = (activeItems ?? []).find(
      (item) => item.item_type === "addon" && item.code === "whatsapp_number",
    );

    if (whatsappQuantity > 0 && whatsappAddon) {
      if (activeWhatsappItem) {
        const { error } = await admin
          .from("subscription_items")
          .update({
            addon_id: whatsappAddon.id,
            description: whatsappAddon.name,
            unit_amount_cents: Number(whatsappAddon.unit_amount_cents),
            quantity: whatsappQuantity,
          })
          .eq("id", activeWhatsappItem.id)
          .eq("subscription_id", subscriptionId);
        if (error) throw error;
      } else {
        const { error } = await admin.from("subscription_items").insert({
          subscription_id: subscriptionId,
          item_type: "addon",
          addon_id: whatsappAddon.id,
          code: whatsappAddon.code,
          description: whatsappAddon.name,
          unit_amount_cents: Number(whatsappAddon.unit_amount_cents),
          quantity: whatsappQuantity,
          status: "active",
          activated_at: activatedAt,
        });
        if (error) throw error;
      }
    } else if (activeWhatsappItem) {
      const { error } = await admin
        .from("subscription_items")
        .update({
          status: "ended",
          ended_at: new Date().toISOString(),
        })
        .eq("id", activeWhatsappItem.id)
        .eq("subscription_id", subscriptionId);
      if (error) throw error;
    }

    const whatsappUnitCents = whatsappAddon
      ? Number(whatsappAddon.unit_amount_cents)
      : 0;
    const currentAmountCents =
      baseAmountCents + whatsappQuantity * whatsappUnitCents;

    const { error: subscriptionUpdateError } = await admin
      .from("subscriptions")
      .update({
        offer_id: targetOffer.id,
        amount_cents: currentAmountCents,
        base_amount_cents: baseAmountCents,
        current_amount_cents: currentAmountCents,
        metadata: {
          ...metadata,
          reconciledComposition: true,
          reconciledAt: new Date().toISOString(),
          reconciledByIntegration: integrationKey,
        },
      })
      .eq("id", subscriptionId);

    if (subscriptionUpdateError) throw subscriptionUpdateError;

    const { data: items, error: itemsError } = await admin
      .from("subscription_items")
      .select("id,item_type,code,description,unit_amount_cents,quantity,status,offer_id,addon_id")
      .eq("subscription_id", subscriptionId)
      .eq("status", "active")
      .order("created_at");

    if (itemsError) throw itemsError;

    return NextResponse.json({
      ok: true,
      subscription: {
        id: subscriptionId,
        offer_reference: targetOffer.checkout_slug,
        base_amount_cents: baseAmountCents,
        current_amount_cents: currentAmountCents,
        items: (items ?? []).map((item) => ({
          id: item.id,
          type: item.item_type,
          code: item.code,
          description: item.description,
          unit_amount_cents: Number(item.unit_amount_cents),
          quantity: Number(item.quantity),
          total_amount_cents:
            Number(item.unit_amount_cents) * Number(item.quantity),
          offer_id: item.offer_id,
          addon_id: item.addon_id,
        })),
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
