import { NextResponse } from "next/server";
import { asObject, jsonError, requiredString } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/require-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchAffiliateMembershipWebhooksSafe } from "@/lib/integrations/affiliate-webhook";

type Context = { params: Promise<{ productId: string; membershipId: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const { productId, membershipId } = await context.params;
    const { supabase, user } = await requireUser();
    const { data: owns } = await supabase.rpc("owns_product", { target_product_id: productId });
    if (!owns) return NextResponse.json({ error: "Produto nao encontrado." }, { status: 404 });
    const status = requiredString(asObject(await request.json()), "status", 20);
    if (status !== "active" && status !== "rejected" && status !== "blocked") {
      return NextResponse.json({ error: "Status invalido." }, { status: 400 });
    }
    const admin = createAdminClient();
    const { data: current, error: currentError } = await admin.from("affiliate_memberships")
      .select("id, code, affiliate_programs!inner(product_id)").eq("id", membershipId).single();
    if (currentError || !current || current.affiliate_programs.product_id !== productId) {
      return NextResponse.json({ error: "Afiliado nao encontrado." }, { status: 404 });
    }
    const { data: membership, error } = await admin.from("affiliate_memberships").update({
      status,
      approved_by: status === "active" ? user.id : null,
      approved_at: status === "active" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq("id", membershipId).select().single();
    if (error || !membership) throw error ?? new Error("Falha ao atualizar afiliado.");
    if (status === "active") {
      const { error: linkError } = await admin.from("affiliate_links").upsert({
        membership_id: membership.id, ref_code: membership.code,
      }, { onConflict: "ref_code" });
      if (linkError) throw linkError;
    }
    await dispatchAffiliateMembershipWebhooksSafe(admin, membership.id);
    return NextResponse.json({ membership });
  } catch (error) { return jsonError(error); }
}
