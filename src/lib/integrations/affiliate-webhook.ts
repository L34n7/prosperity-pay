import { createAdminClient } from "@/lib/supabase/admin";
import { deliverIntegrationWebhook } from "@/lib/integrations/outbound-webhook";
import type { Json } from "@/lib/supabase/database.types";

type AdminClient = ReturnType<typeof createAdminClient>;

function eventTypeFor(status: string) {
  if (status === "active") return "affiliate.active";
  if (status === "blocked") return "affiliate.blocked";
  if (status === "rejected") return "affiliate.rejected";
  if (status === "cancelled") return "affiliate.cancelled";
  return "affiliate.pending";
}

export async function dispatchAffiliateMembershipWebhooks(admin: AdminClient, membershipId: string) {
  const { data: membership, error: membershipError } = await admin.from("affiliate_memberships")
    .select("id,program_id,user_id,code,status,approved_at,created_at,updated_at")
    .eq("id", membershipId)
    .single();
  if (membershipError || !membership) throw membershipError ?? new Error("Afiliação não encontrada.");

  const [programResult, profileResult] = await Promise.all([
    admin.from("affiliate_programs")
      .select("id,product_id,mode,cookie_days,attribution_model,active")
      .eq("id", membership.program_id)
      .single(),
    admin.from("profiles").select("id,full_name,email").eq("id", membership.user_id).single(),
  ]);
  if (programResult.error || !programResult.data) throw programResult.error ?? new Error("Programa de afiliados não encontrado.");
  if (profileResult.error || !profileResult.data) throw profileResult.error ?? new Error("Perfil do afiliado não encontrado.");

  const program = programResult.data;
  const [productResult, offersResult] = await Promise.all([
    admin.from("products").select("id,name,producer_id,affiliate_funnel_base_url").eq("id", program.product_id).single(),
    admin.from("offers")
      .select("id,name,checkout_slug,status,affiliate_enabled,affiliate_commission_type,affiliate_commission_bps,affiliate_commission_fixed_cents")
      .eq("product_id", program.product_id),
  ]);
  if (productResult.error || !productResult.data) throw productResult.error ?? new Error("Produto não encontrado.");
  if (offersResult.error) throw offersResult.error;

  const offers = offersResult.data ?? [];
  const references = offers.map((offer) => offer.checkout_slug).filter(Boolean);
  if (!references.length) return { sent: 0, integrations: [] as string[] };

  const { data: routes, error: routesError } = await (admin as any)
    .from("integration_webhook_routes")
    .select("integration,offer_reference")
    .eq("active", true)
    .in("offer_reference", references);
  if (routesError) throw routesError;
  if (!routes?.length) return { sent: 0, integrations: [] as string[] };

  const byIntegration = new Map<string, Set<string>>();
  for (const route of routes as Array<{ integration: string; offer_reference: string }>) {
    if (!byIntegration.has(route.integration)) byIntegration.set(route.integration, new Set());
    byIntegration.get(route.integration)!.add(route.offer_reference);
  }

  const affiliateFunnelBaseUrl = productResult.data.affiliate_funnel_base_url;
  const affiliateFunnelUrl = affiliateFunnelBaseUrl
    ? `${affiliateFunnelBaseUrl}${encodeURIComponent(membership.code)}`
    : null;

  const eventType = eventTypeFor(String(membership.status));
  const subjectId = `${membership.id}:${membership.status}:${membership.approved_at || membership.updated_at || membership.created_at}`;
  const occurredAt = new Date().toISOString();
  const results: Array<{ integration: string; sent: boolean }> = [];

  for (const [integrationKey, routedReferences] of byIntegration) {
    const routedOffers = offers
      .filter((offer) => routedReferences.has(offer.checkout_slug))
      .map((offer) => ({
        id: offer.id,
        reference: offer.checkout_slug,
        name: offer.name,
        status: offer.status,
        affiliate_enabled: offer.affiliate_enabled,
        commission_type: offer.affiliate_commission_type,
        commission_bps: offer.affiliate_commission_bps,
        commission_fixed_cents: offer.affiliate_commission_fixed_cents,
      }));

    const payload = {
      version: "2026-09-18",
      event: eventType,
      occurred_at: occurredAt,
      integration: { key: integrationKey },
      affiliate: {
        id: membership.id,
        reference: membership.code,
        status: membership.status,
        user_id: membership.user_id,
        name: profileResult.data.full_name,
        email: profileResult.data.email,
        approved_at: membership.approved_at,
        created_at: membership.created_at,
        updated_at: membership.updated_at,
      },
      program: {
        id: program.id,
        mode: program.mode,
        active: program.active,
        cookie_days: program.cookie_days,
        attribution_model: program.attribution_model,
      },
      product: {
        id: productResult.data.id,
        name: productResult.data.name,
        producer_id: productResult.data.producer_id,
      },
      offers: routedOffers,
      tracking: {
        parameter: "ref",
        value: membership.code,
        base_url: affiliateFunnelBaseUrl,
        url: affiliateFunnelUrl,
      },
    } satisfies Json;

    const result = await deliverIntegrationWebhook({
      admin,
      integrationKey,
      subjectType: "affiliate_membership",
      subjectId,
      eventType,
      payload,
    });
    results.push({ integration: integrationKey, sent: result.sent === true });
  }

  return { sent: results.filter((result) => result.sent).length, integrations: results.map((result) => result.integration) };
}

export async function dispatchAffiliateMembershipWebhooksSafe(admin: AdminClient, membershipId: string) {
  try {
    return await dispatchAffiliateMembershipWebhooks(admin, membershipId);
  } catch (error) {
    console.error("[AFFILIATE WEBHOOK] Falha ao sincronizar afiliação", {
      membershipId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { sent: 0, integrations: [] as string[], error: true };
  }
}
