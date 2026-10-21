import { HttpError } from "@/lib/api/http";
import { createPrepaidSubscriptionIntent } from "@/lib/subscriptions/prepaid-billing";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";

type AdminClient = ReturnType<typeof createAdminClient>;

type SubscriptionCandidate = {
  id: string;
  status: string;
  offer_id: string;
  current_period_end: string | null;
  external_reference: string | null;
  metadata: Json;
  created_at: string;
};

function metadataObject(value: Json) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, Json | undefined>)
    : {};
}

function canonicalScore(candidate: SubscriptionCandidate) {
  const metadata = metadataObject(candidate.metadata);
  const reference = String(candidate.external_reference || "");
  let score = 0;
  if (reference.startsWith("crm_prosperity:")) score += 1000;
  else if (reference) score += 200;
  if (metadata.imported === true) score += 500;
  if (candidate.status === "active") score += 50;
  if (candidate.status === "past_due") score += 40;
  return score;
}

export function chooseCanonicalSubscription(
  candidates: SubscriptionCandidate[],
) {
  return [...candidates].sort((a, b) => {
    const score = canonicalScore(b) - canonicalScore(a);
    if (score !== 0) return score;

    const aEnd = a.current_period_end
      ? new Date(a.current_period_end).getTime()
      : Number.NEGATIVE_INFINITY;
    const bEnd = b.current_period_end
      ? new Date(b.current_period_end).getTime()
      : Number.NEGATIVE_INFINITY;
    if (aEnd !== bEnd) return bEnd - aEnd;

    return (
      new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
  })[0] ?? null;
}

export function resolveExistingSubscriptionAction(input: {
  subscriptionOfferId: string;
  targetOfferId: string;
}) {
  return input.subscriptionOfferId === input.targetOfferId
    ? ("renew" as const)
    : ("plan_change_required" as const);
}

async function resolveAffiliate(
  admin: AdminClient,
  refCode: string | null | undefined,
  productId: string,
  offerAffiliateEnabled: boolean,
) {
  const normalized = String(refCode || "").trim();
  if (!normalized || !offerAffiliateEnabled) return null;

  const { data: link, error } = await admin
    .from("affiliate_links")
    .select(
      "id,membership_id,affiliate_memberships!inner(id,status,affiliate_programs!inner(product_id,active))",
    )
    .eq("ref_code", normalized)
    .eq("active", true)
    .maybeSingle();

  if (error) throw error;
  const membership = Array.isArray(link?.affiliate_memberships)
    ? link?.affiliate_memberships[0]
    : link?.affiliate_memberships;
  const program = Array.isArray(membership?.affiliate_programs)
    ? membership?.affiliate_programs[0]
    : membership?.affiliate_programs;

  if (
    !link ||
    !membership ||
    membership.status !== "active" ||
    !program?.active ||
    program.product_id !== productId
  ) {
    return null;
  }

  return {
    refCode: normalized,
    membershipId: link.membership_id,
    linkId: link.id,
  };
}

async function attachAffiliateToSession(input: {
  admin: AdminClient;
  sessionId: string | undefined;
  affiliate: Awaited<ReturnType<typeof resolveAffiliate>>;
}) {
  if (!input.sessionId || !input.affiliate) return;

  const { data: session, error } = await input.admin
    .from("subscription_checkout_sessions")
    .select("metadata")
    .eq("id", input.sessionId)
    .single();
  if (error || !session) throw error ?? new Error("Sessão não encontrada.");

  const metadata = metadataObject(session.metadata as Json);
  const { error: updateError } = await input.admin
    .from("subscription_checkout_sessions")
    .update({
      metadata: {
        ...metadata,
        affiliateRefCode: input.affiliate.refCode,
        affiliateMembershipId: input.affiliate.membershipId,
        affiliateLinkId: input.affiliate.linkId,
        affiliateAttributionSource: "public_checkout",
      } as Json,
    })
    .eq("id", input.sessionId);
  if (updateError) throw updateError;
}

export async function resolveExistingSubscriptionCheckout(input: {
  offerSlug: string;
  customerEmail: string;
  affiliateRefCode?: string | null;
}) {
  const admin = createAdminClient();
  const email = input.customerEmail.trim().toLowerCase();
  const offerSlug = input.offerSlug.trim().toLowerCase();

  if (!email || !offerSlug) {
    throw new HttpError(400, "E-mail e oferta são obrigatórios.");
  }

  const { data: offer, error: offerError } = await admin
    .from("offers")
    .select("id,product_id,checkout_slug,billing_type,affiliate_enabled")
    .eq("checkout_slug", offerSlug)
    .eq("status", "active")
    .maybeSingle();

  if (offerError) throw offerError;
  if (!offer || offer.billing_type !== "recurring") {
    return { matched: false as const };
  }

  const { data: customer, error: customerError } = await admin
    .from("customers")
    .select("id")
    .eq("email", email)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (customerError) throw customerError;
  if (!customer) return { matched: false as const };

  const { data: subscriptions, error: subscriptionsError } = await admin
    .from("subscriptions")
    .select(
      "id,status,offer_id,current_period_end,external_reference,metadata,created_at",
    )
    .eq("customer_id", customer.id)
    .eq("product_id", offer.product_id)
    .in("status", ["active", "past_due"]);

  if (subscriptionsError) throw subscriptionsError;
  const subscription = chooseCanonicalSubscription(
    (subscriptions ?? []) as SubscriptionCandidate[],
  );
  if (!subscription) return { matched: false as const };

  const action = resolveExistingSubscriptionAction({
    subscriptionOfferId: subscription.offer_id,
    targetOfferId: offer.id,
  });

  if (action === "plan_change_required") {
    return {
      matched: true as const,
      subscriptionId: subscription.id,
      action,
      status: action,
      checkoutUrl: null,
      scheduled: false,
      requiresPlanChange: true,
      effectiveAt: null,
      amountCents: null,
      targetAmountCents: null,
      message:
        "Você já possui este produto em outro plano. Faça a troca em Gerenciar plano para manter adicionais e calcular o valor correto.",
    };
  }

  const intent = await createPrepaidSubscriptionIntent({
    subscriptionId: subscription.id,
    action: { type: "renew" },
    renewalSessionTtlHours: 24,
  });

  const affiliate = await resolveAffiliate(
    admin,
    input.affiliateRefCode,
    offer.product_id,
    Boolean(offer.affiliate_enabled),
  );

  await attachAffiliateToSession({
    admin,
    sessionId: "sessionId" in intent ? intent.sessionId : undefined,
    affiliate,
  });

  return {
    matched: true as const,
    subscriptionId: subscription.id,
    action,
    status: intent.status,
    checkoutUrl:
      "checkoutUrl" in intent ? intent.checkoutUrl ?? null : null,
    scheduled: intent.status === "scheduled",
    requiresPlanChange: false,
    effectiveAt:
      "effectiveAt" in intent ? intent.effectiveAt ?? null : null,
    amountCents: intent.amountCents,
    targetAmountCents:
      "targetAmountCents" in intent
        ? intent.targetAmountCents ?? null
        : null,
    message: null,
  };
}
