import { createHash, randomBytes } from "node:crypto";
import { isValidBuyerEmail } from "@/lib/checkout/buyer-validation";
import { createAdminClient } from "@/lib/supabase/admin";

const SESSION_TTL_MS = 60 * 60 * 1000;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeAffiliateRef(value?: string | null) {
  const ref = String(value ?? "").trim();
  return ref && ref.length <= 128 && /^[A-Za-z0-9_-]+$/.test(ref)
    ? ref
    : null;
}

export async function createCheckoutPrefillSession(input: {
  integrationKey: string;
  offerSlug: string;
  customerName: string;
  customerEmail: string;
  affiliateRef?: string | null;
  sourceReference?: string | null;
}) {
  const admin = createAdminClient();
  const offerSlug = input.offerSlug.trim().toLowerCase();
  const customerName = input.customerName.trim();
  const customerEmail = input.customerEmail.trim().toLowerCase();

  if (!customerName || customerName.length > 180) {
    throw new Error("Nome do comprador inválido.");
  }
  if (!isValidBuyerEmail(customerEmail)) {
    throw new Error("E-mail do comprador inválido.");
  }

  const { data: offer, error: offerError } = await admin
    .from("offers")
    .select("checkout_slug")
    .eq("checkout_slug", offerSlug)
    .eq("status", "active")
    .maybeSingle();

  if (offerError) throw offerError;
  if (!offer) throw new Error("Oferta ativa não encontrada.");

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  const { error } = await admin.from("integration_checkout_prefill_sessions").insert({
    integration_key: input.integrationKey,
    token_hash: hashToken(token),
    offer_slug: offer.checkout_slug,
    customer_name: customerName,
    customer_email: customerEmail,
    affiliate_ref: normalizeAffiliateRef(input.affiliateRef),
    source_reference: String(input.sourceReference ?? "").trim().slice(0, 200) || null,
    expires_at: expiresAt,
  });

  if (error) throw error;

  return { token, expiresAt, offerSlug: offer.checkout_slug };
}

export async function getCheckoutPrefillSession(input: {
  token?: string | null;
  offerSlug: string;
}) {
  const token = String(input.token ?? "").trim();
  if (!token || token.length > 256) return null;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("integration_checkout_prefill_sessions")
    .select("customer_name,customer_email,affiliate_ref,expires_at")
    .eq("token_hash", hashToken(token))
    .eq("offer_slug", input.offerSlug.trim().toLowerCase())
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) {
    console.error("[checkout-prefill] Falha ao recuperar sessão.", error);
    return null;
  }
  if (!data) return null;

  return {
    name: data.customer_name,
    email: data.customer_email,
    affiliateRef: data.affiliate_ref ?? undefined,
    expiresAt: data.expires_at,
  };
}
