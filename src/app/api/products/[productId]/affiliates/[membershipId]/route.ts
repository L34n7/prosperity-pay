import { NextResponse } from "next/server";
import { asObject, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/require-user";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.current.types";
import { dispatchAffiliateMembershipWebhooksSafe } from "@/lib/integrations/affiliate-webhook";
import {
  parseAddonCommissionOverrides,
  parseOfferCommissionOverrides,
  saveAddonCommissionOverrides,
  saveOfferCommissionOverrides,
} from "@/lib/affiliates/offer-commission-overrides";

type Context = { params: Promise<{ productId: string; membershipId: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const { productId, membershipId } = await context.params;
    const { supabase, user } = await requireUser();
    const { data: owns } = await supabase.rpc("owns_product", { target_product_id: productId });
    if (!owns) return NextResponse.json({ error: "Produto nao encontrado." }, { status: 404 });
    const body = asObject(await request.json());
    const rawStatus = typeof body.status === "string" ? body.status : undefined;
    const hasCommissionOverride = Object.prototype.hasOwnProperty.call(body, "commissionBpsOverride");
    const hasOfferCommissionOverrides = Object.prototype.hasOwnProperty.call(body, "offerCommissionOverrides");
    const hasAddonCommissionOverrides = Object.prototype.hasOwnProperty.call(body, "addonCommissionOverrides");
    let offerCommissionOverrides: ReturnType<typeof parseOfferCommissionOverrides> = [];
    let addonCommissionOverrides: ReturnType<typeof parseAddonCommissionOverrides> = [];
    try {
      if (hasOfferCommissionOverrides) {
        offerCommissionOverrides = parseOfferCommissionOverrides(body.offerCommissionOverrides);
      }
      if (hasAddonCommissionOverrides) {
        addonCommissionOverrides = parseAddonCommissionOverrides(body.addonCommissionOverrides);
      }
    } catch (cause) {
      return NextResponse.json({ error: cause instanceof Error ? cause.message : "Configuração individual inválida." }, { status: 400 });
    }
    const rawPartnerType = typeof body.partnerType === "string" ? body.partnerType : undefined;
    const partnerType =
      rawPartnerType === "affiliate" || rawPartnerType === "accredited"
        ? rawPartnerType
        : undefined;
    if (rawPartnerType && !partnerType) {
      return NextResponse.json({ error: "Tipo de parceiro inválido." }, { status: 400 });
    }
    if (rawStatus && rawStatus !== "active" && rawStatus !== "rejected" && rawStatus !== "blocked") {
      return NextResponse.json({ error: "Status invalido." }, { status: 400 });
    }
    const status: "active" | "rejected" | "blocked" | undefined =
      rawStatus === "active" || rawStatus === "rejected" || rawStatus === "blocked" ? rawStatus : undefined;
    if (!status && !hasCommissionOverride && !hasOfferCommissionOverrides && !hasAddonCommissionOverrides && !partnerType) {
      return NextResponse.json({ error: "Nenhuma alteração informada." }, { status: 400 });
    }
    let commissionBpsOverride: number | null | undefined;
    if (hasCommissionOverride) {
      if (body.commissionBpsOverride === null || body.commissionBpsOverride === "") {
        commissionBpsOverride = null;
      } else {
        const parsed = Number(body.commissionBpsOverride);
        if (!Number.isInteger(parsed) || parsed < 0 || parsed > 10_000) {
          return NextResponse.json({ error: "Comissão individual inválida. Use um valor entre 0% e 100%." }, { status: 400 });
        }
        commissionBpsOverride = parsed;
      }
    }
    const admin = createAdminClient();
    const { data: current, error: currentError } = await admin.from("affiliate_memberships")
      .select("id, code, partner_type, affiliate_programs!inner(product_id)").eq("id", membershipId).single();
    if (currentError || !current || current.affiliate_programs.product_id !== productId) {
      return NextResponse.json({ error: "Afiliado nao encontrado." }, { status: 404 });
    }
    if (partnerType === "accredited" && current.partner_type !== "accredited") {
      const { data: accreditedSettings, error: accreditedSettingsError } = await admin
        .from("product_accredited_settings")
        .select("active,allow_affiliate_evolution")
        .eq("product_id", productId)
        .maybeSingle();
      if (accreditedSettingsError) throw accreditedSettingsError;
      if (
        accreditedSettings &&
        (!accreditedSettings.active || !accreditedSettings.allow_affiliate_evolution)
      ) {
        return NextResponse.json(
          { error: "A evolução de Afiliado para Credenciado está desabilitada nas configurações do produto." },
          { status: 409 },
        );
      }
    }
    const updates: Database["public"]["Tables"]["affiliate_memberships"]["Update"] = {
      updated_at: new Date().toISOString(),
    };
    if (status) {
      updates.status = status;
      updates.approved_by = status === "active" ? user.id : null;
      updates.approved_at = status === "active" ? new Date().toISOString() : null;
    }
    if (hasCommissionOverride) updates.affiliate_commission_bps_override = commissionBpsOverride ?? null;
    if (partnerType) updates.partner_type = partnerType;
    const { data: membership, error } = await admin.from("affiliate_memberships").update(updates)
      .eq("id", membershipId).select().single();
    if (error || !membership) throw error ?? new Error("Falha ao atualizar afiliado.");
    const [offerOverrides, addonOverrides] = await Promise.all([
      hasOfferCommissionOverrides
        ? saveOfferCommissionOverrides({
            admin,
            productId,
            membershipId,
            overrides: offerCommissionOverrides,
          })
        : Promise.resolve(null),
      hasAddonCommissionOverrides
        ? saveAddonCommissionOverrides({
            admin,
            productId,
            membershipId,
            overrides: addonCommissionOverrides,
          })
        : Promise.resolve(null),
    ]);
    if (status === "active") {
      const { error: linkError } = await admin.from("affiliate_links").upsert({
        membership_id: membership.id, ref_code: membership.code, active: true,
      }, { onConflict: "ref_code" });
      if (linkError) throw linkError;
    }
    await dispatchAffiliateMembershipWebhooksSafe(admin, membership.id);
    return NextResponse.json({
      membership,
      offerCommissionOverrides: offerOverrides,
      addonCommissionOverrides: addonOverrides,
    });
  } catch (error) { return jsonError(error); }
}
