import { NextResponse } from "next/server";
import { asObject, jsonError, requiredString } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/require-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchAffiliateMembershipWebhooksSafe } from "@/lib/integrations/affiliate-webhook";

export async function POST(request: Request) {
  try {
    const { user } = await requireUser();
    const body = asObject(await request.json());
    const code = requiredString(body, "code", 80);
    const action = requiredString(body, "action", 10);
    if (action !== "accept" && action !== "reject") {
      return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: membership, error } = await admin.from("affiliate_memberships")
      .select("id, user_id, code, status, partner_type, invited_by, affiliate_programs!inner(id, mode, active)")
      .eq("code", code)
      .eq("status", "pending")
      .maybeSingle();
    if (error) throw error;
    if (!membership) return NextResponse.json({ error: "Convite inválido ou já respondido." }, { status: 404 });
    if (membership.user_id !== user.id) {
      return NextResponse.json({ error: "Este convite pertence a outra conta." }, { status: 403 });
    }

    const program = membership.affiliate_programs;
    if (!program || Array.isArray(program) || !program.active || program.mode !== "invite") {
      return NextResponse.json({ error: "Este programa de afiliados não está disponível para convites." }, { status: 409 });
    }

    if (action === "reject") {
      const { error: rejectError } = await admin.from("affiliate_memberships").update({ status: "rejected", updated_at: new Date().toISOString() }).eq("id", membership.id);
      if (rejectError) throw rejectError;
      await dispatchAffiliateMembershipWebhooksSafe(admin, membership.id);
      return NextResponse.json({ accepted: false });
    }

    const { data: updated, error: updateError } = await admin.from("affiliate_memberships").update({
      status: "active",
      approved_by: membership.invited_by,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", membership.id).select("id, code, status, partner_type").single();
    if (updateError) throw updateError;

    const { error: linkError } = await admin.from("affiliate_links").upsert({
      membership_id: updated.id,
      ref_code: updated.code,
    }, { onConflict: "ref_code" });
    if (linkError) throw linkError;

    await dispatchAffiliateMembershipWebhooksSafe(admin, updated.id);
    return NextResponse.json({ accepted: true, membership: updated });
  } catch (error) {
    return jsonError(error);
  }
}
