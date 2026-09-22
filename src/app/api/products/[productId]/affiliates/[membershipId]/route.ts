import { NextResponse } from "next/server";
import { asObject, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/require-user";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.current.types";
import { dispatchAffiliateMembershipWebhooksSafe } from "@/lib/integrations/affiliate-webhook";

type Context = { params: Promise<{ productId: string; membershipId: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const { productId, membershipId } = await context.params;
    const { supabase, user } = await requireUser();
    const { data: owns } = await supabase.rpc("owns_product", { target_product_id: productId });
    if (!owns) return NextResponse.json({ error: "Produto nao encontrado." }, { status: 404 });
    const body = asObject(await request.json());
    const status = typeof body.status === "string" ? body.status : undefined;
    const hasCommissionOverride = Object.prototype.hasOwnProperty.call(body, "commissionBpsOverride");
    if (status && status !== "active" && status !== "rejected" && status !== "blocked") {
      return NextResponse.json({ error: "Status invalido." }, { status: 400 });
    }
    if (!status && !hasCommissionOverride) {
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
      .select("id, code, affiliate_programs!inner(product_id)").eq("id", membershipId).single();
    if (currentError || !current || current.affiliate_programs.product_id !== productId) {
      return NextResponse.json({ error: "Afiliado nao encontrado." }, { status: 404 });
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
    const { data: membership, error } = await admin.from("affiliate_memberships").update(updates)
      .eq("id", membershipId).select().single();
    if (error || !membership) throw error ?? new Error("Falha ao atualizar afiliado.");
    if (status === "active") {
      const { error: linkError } = await admin.from("affiliate_links").upsert({
        membership_id: membership.id, ref_code: membership.code, active: true,
      }, { onConflict: "ref_code" });
      if (linkError) throw linkError;
    }
    await dispatchAffiliateMembershipWebhooksSafe(admin, membership.id);
    return NextResponse.json({ membership });
  } catch (error) { return jsonError(error); }
}
