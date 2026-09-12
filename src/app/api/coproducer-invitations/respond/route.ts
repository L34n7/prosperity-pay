import { NextResponse } from "next/server";
import { asObject, jsonError, requiredString } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/require-user";
import { sha256 } from "@/lib/security/hash";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  try {
    const { user } = await requireUser();
    const body = asObject(await request.json());
    const token = requiredString(body, "token", 100);
    const action = requiredString(body, "action", 10);
    if (action !== "accept" && action !== "reject") return NextResponse.json({ error: "Acao invalida." }, { status: 400 });
    const admin = createAdminClient();
    const { data: invitation, error } = await admin.from("coproducer_invitations").select("*")
      .eq("token_hash", sha256(token)).eq("status", "pending").single();
    if (error || !invitation || new Date(invitation.expires_at) <= new Date()) {
      return NextResponse.json({ error: "Convite invalido ou expirado." }, { status: 404 });
    }
    if (invitation.invited_user_id && invitation.invited_user_id !== user.id) {
      return NextResponse.json({ error: "Este convite pertence a outro usuario." }, { status: 403 });
    }
    if (!invitation.invited_user_id && invitation.invited_email.toLowerCase() !== user.email?.toLowerCase()) {
      return NextResponse.json({ error: "Use o e-mail que recebeu o convite." }, { status: 403 });
    }
    if (action === "accept") {
      const { error: participantError } = await admin.from("product_participants").insert({
        product_id: invitation.product_id, offer_id: invitation.offer_id, user_id: user.id,
        invitation_id: invitation.id, participation_bps: invitation.participation_bps,
      });
      if (participantError) throw participantError;
    }
    const { error: updateError } = await admin.from("coproducer_invitations").update({
      status: action === "accept" ? "accepted" : "rejected",
      invited_user_id: user.id,
      responded_at: new Date().toISOString(),
    }).eq("id", invitation.id);
    if (updateError) throw updateError;
    return NextResponse.json({ accepted: action === "accept" });
  } catch (error) { return jsonError(error); }
}
