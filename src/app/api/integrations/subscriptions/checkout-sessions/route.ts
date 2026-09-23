import { NextResponse } from "next/server";
import { asObject, HttpError, jsonError, requiredString } from "@/lib/api/http";
import { requireSignedIntegrationRequest } from "@/lib/integrations/inbound-auth";
import { createPrepaidSubscriptionIntent, type SubscriptionAction } from "@/lib/subscriptions/prepaid-billing";
import { createAdminClient } from "@/lib/supabase/admin";

async function ensureIntegrationOwnsSubscriptionRoute(integrationKey: string, subscriptionId: string) {
  const admin = createAdminClient();
  const { data: subscription, error: subscriptionError } = await admin.from("subscriptions")
    .select("offer_id")
    .eq("id", subscriptionId)
    .single();
  if (subscriptionError || !subscription) throw new HttpError(404, "Assinatura não encontrada.");

  const { data: offer, error: offerError } = await admin.from("offers")
    .select("checkout_slug")
    .eq("id", subscription.offer_id)
    .single();
  if (offerError || !offer) throw new HttpError(404, "Oferta da assinatura não encontrada.");

  const { data: route, error: routeError } = await admin.from("integration_webhook_routes")
    .select("id")
    .eq("integration", integrationKey)
    .eq("offer_reference", offer.checkout_slug)
    .eq("active", true)
    .maybeSingle();
  if (routeError) throw routeError;
  if (!route) throw new HttpError(403, "Esta integração não pode alterar a assinatura informada.");
}

function parseAction(body: Record<string, unknown>): SubscriptionAction {
  const action = asObject(body.action);
  const type = requiredString(action, "type", 40);
  if (type === "renew") return { type };

  if (type === "change_plan") {
    return {
      type,
      offerReference: requiredString(action, "offerReference", 120).toLowerCase(),
    };
  }

  if (type === "add_addon" || type === "remove_addon") {
    const rawQuantity = action.quantity;
    const quantity = rawQuantity == null ? undefined : Number(rawQuantity);
    if (quantity !== undefined && (!Number.isSafeInteger(quantity) || quantity <= 0)) {
      throw new HttpError(400, "Quantidade inválida.");
    }
    return {
      type,
      addonCode: requiredString(action, "addonCode", 100).toLowerCase(),
      quantity,
    };
  }

  throw new HttpError(400, "Ação de assinatura inválida.");
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
    await ensureIntegrationOwnsSubscriptionRoute(integrationKey, subscriptionId);

    const result = await createPrepaidSubscriptionIntent({
      subscriptionId,
      action: parseAction(body),
    });

    return NextResponse.json(result, { status: result.status === "scheduled" ? 200 : 201 });
  } catch (error) {
    return jsonError(error);
  }
}
