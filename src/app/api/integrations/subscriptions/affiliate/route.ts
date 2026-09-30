import { NextResponse } from "next/server";
import { asObject, HttpError, jsonError, requiredString } from "@/lib/api/http";
import { requireSignedIntegrationRequest } from "@/lib/integrations/inbound-auth";
import { createAdminClient } from "@/lib/supabase/admin";

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

  if (!references.length) {
    throw new HttpError(
      403,
      "Esta integração não pode alterar a afiliação desta assinatura.",
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
      "Esta integração não pode alterar a afiliação desta assinatura.",
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
    const affiliateRefCode = requiredString(
      body,
      "affiliateRefCode",
      120,
    );

    const admin = createAdminClient();

    const { data: subscription, error: subscriptionError } = await admin
      .from("subscriptions")
      .select("id,product_id,metadata")
      .eq("id", subscriptionId)
      .single();

    if (subscriptionError || !subscription) {
      throw subscriptionError ?? new HttpError(404, "Assinatura não encontrada.");
    }

    await ensureIntegrationOwnsProduct(
      admin,
      integrationKey,
      subscription.product_id,
    );

    const { data: link, error: linkError } = await admin
      .from("affiliate_links")
      .select("id,membership_id")
      .eq("ref_code", affiliateRefCode)
      .eq("active", true)
      .maybeSingle();

    if (linkError) throw linkError;
    if (!link) {
      throw new HttpError(409, "Link de afiliado informado não está ativo.");
    }

    const { data: membership, error: membershipError } = await admin
      .from("affiliate_memberships")
      .select("id,program_id,status")
      .eq("id", link.membership_id)
      .maybeSingle();

    if (membershipError) throw membershipError;
    if (!membership || membership.status !== "active") {
      throw new HttpError(409, "Afiliado informado não está ativo.");
    }

    const { data: program, error: programError } = await admin
      .from("affiliate_programs")
      .select("id,product_id,active")
      .eq("id", membership.program_id)
      .maybeSingle();

    if (programError) throw programError;
    if (!program?.active || program.product_id !== subscription.product_id) {
      throw new HttpError(
        409,
        "O afiliado informado não pertence ao programa deste produto.",
      );
    }

    const metadata =
      subscription.metadata &&
      typeof subscription.metadata === "object" &&
      !Array.isArray(subscription.metadata)
        ? (subscription.metadata as Record<string, unknown>)
        : {};

    const syncedAt = new Date().toISOString();
    const { error: updateError } = await admin
      .from("subscriptions")
      .update({
        affiliate_membership_id: membership.id,
        affiliate_link_id: link.id,
        metadata: {
          ...metadata,
          affiliateRefCode,
          affiliateSyncedAt: syncedAt,
          affiliateSyncedByIntegration: integrationKey,
        },
      })
      .eq("id", subscription.id);

    if (updateError) throw updateError;

    return NextResponse.json({
      ok: true,
      subscription_id: subscription.id,
      affiliate_ref: affiliateRefCode,
      affiliate_membership_id: membership.id,
      affiliate_link_id: link.id,
      synced_at: syncedAt,
    });
  } catch (error) {
    return jsonError(error);
  }
}
