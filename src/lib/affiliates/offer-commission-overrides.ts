import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export type OfferCommissionOverride = {
  offerId: string;
  commissionBps: number | null;
};

export function parseOfferCommissionOverrides(value: unknown): OfferCommissionOverride[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error("Configuração individual de ofertas inválida.");

  const seen = new Set<string>();
  return value.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("Configuração individual de oferta inválida.");
    }
    const item = raw as Record<string, unknown>;
    const offerId = typeof item.offerId === "string" ? item.offerId.trim() : "";
    if (!offerId || seen.has(offerId)) throw new Error("Oferta individual inválida ou duplicada.");
    seen.add(offerId);

    if (item.commissionBps === null || item.commissionBps === "" || item.commissionBps === undefined) {
      return { offerId, commissionBps: null };
    }

    const commissionBps = Number(item.commissionBps);
    if (!Number.isInteger(commissionBps) || commissionBps < 0 || commissionBps > 10_000) {
      throw new Error("Comissão individual inválida. Use um valor entre 0% e 100%.");
    }
    return { offerId, commissionBps };
  });
}

export async function saveOfferCommissionOverrides(input: {
  admin: AdminClient;
  productId: string;
  membershipId: string;
  overrides: OfferCommissionOverride[];
}) {
  const { admin, productId, membershipId, overrides } = input;
  if (!overrides.length) return [];

  const { data: offers, error: offersError } = await admin
    .from("offers")
    .select("id")
    .eq("product_id", productId);
  if (offersError) throw offersError;

  const allowed = new Set((offers ?? []).map((offer) => offer.id));
  for (const item of overrides) {
    if (!allowed.has(item.offerId)) throw new Error("Uma das ofertas não pertence a este produto.");
  }

  const clearIds = overrides.filter((item) => item.commissionBps === null).map((item) => item.offerId);
  if (clearIds.length) {
    const { error } = await admin
      .from("affiliate_offer_commission_overrides")
      .delete()
      .eq("membership_id", membershipId)
      .in("offer_id", clearIds);
    if (error) throw error;
  }

  const custom = overrides
    .filter((item): item is { offerId: string; commissionBps: number } => item.commissionBps !== null)
    .map((item) => ({
      membership_id: membershipId,
      offer_id: item.offerId,
      commission_bps: item.commissionBps,
      updated_at: new Date().toISOString(),
    }));

  if (custom.length) {
    const { error } = await admin
      .from("affiliate_offer_commission_overrides")
      .upsert(custom, { onConflict: "membership_id,offer_id" });
    if (error) throw error;
  }

  const { data, error } = await admin
    .from("affiliate_offer_commission_overrides")
    .select("offer_id,commission_bps")
    .eq("membership_id", membershipId);
  if (error) throw error;
  return data ?? [];
}

export async function resolveOfferCommissionOverride(input: {
  admin: AdminClient;
  membershipId: string;
  offerId: string;
  legacyMembershipOverride?: number | null;
}) {
  const { admin, membershipId, offerId, legacyMembershipOverride } = input;
  const { data, error } = await admin
    .from("affiliate_offer_commission_overrides")
    .select("commission_bps")
    .eq("membership_id", membershipId)
    .eq("offer_id", offerId)
    .maybeSingle();
  if (error) throw error;
  if (data) return Number(data.commission_bps);
  return legacyMembershipOverride ?? null;
}
