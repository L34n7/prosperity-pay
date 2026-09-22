import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { asObject, jsonError, optionalString, requiredInteger, requiredString } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/require-user";
import { env, requireEnv } from "@/lib/env";
import { sendCoproducerInvitationEmail } from "@/lib/email/resend-auth";
import { sha256 } from "@/lib/security/hash";
import { createAdminClient } from "@/lib/supabase/admin";

type Context = { params: Promise<{ productId: string }> };

export async function GET(_: Request, context: Context) {
  try {
    const { productId } = await context.params;
    const { supabase } = await requireUser();
    const { data: owns } = await supabase.rpc("owns_product", { target_product_id: productId });
    if (!owns) return NextResponse.json({ error: "Produto não encontrado." }, { status: 404 });

    const [{ data: invitations, error }, { data: participants, error: participantsError }] = await Promise.all([
      supabase.from("coproducer_invitations")
        .select("id,invited_email,participation_bps,status,expires_at,offer_id")
        .eq("product_id", productId)
        .order("created_at", { ascending: false }),
      supabase.from("product_participants")
        .select("id,user_id,participation_bps,active,offer_id,profiles!product_participants_user_id_fkey(full_name,email)")
        .eq("product_id", productId),
    ]);
    if (error || participantsError) throw error ?? participantsError;
    return NextResponse.json({ invitations: invitations ?? [], participants: participants ?? [] });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    const { productId } = await context.params;
    const { supabase, user } = await requireUser();
    const { data: owns } = await supabase.rpc("owns_product", { target_product_id: productId });
    if (!owns) return NextResponse.json({ error: "Produto nao encontrado." }, { status: 404 });
    const body = asObject(await request.json());
    const email = requiredString(body, "email", 320).toLowerCase();
    const participationBps = requiredInteger(body, "participationBps", 1);
    if (participationBps > 10_000) return NextResponse.json({ error: "Participacao invalida." }, { status: 400 });
    const offerId = optionalString(body, "offerId", 36) ?? null;
    const token = randomBytes(32).toString("base64url");
    const admin = createAdminClient();

    const [
      { data: profile, error: profileError },
      { data: product, error: productError },
      offerResult,
    ] = await Promise.all([
      admin.from("profiles").select("id,full_name,email").eq("email", email).maybeSingle(),
      admin.from("products").select("name").eq("id", productId).maybeSingle(),
      offerId
        ? admin.from("offers").select("id,name").eq("id", offerId).eq("product_id", productId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (profileError || productError || offerResult.error) {
      throw profileError ?? productError ?? offerResult.error;
    }

    const { data, error } = await admin.from("coproducer_invitations").insert({
      product_id: productId,
      offer_id: offerId,
      invited_email: email,
      invited_user_id: profile?.id ?? null,
      participation_bps: participationBps,
      token_hash: sha256(token),
      invited_by: user.id,
      expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    }).select("id, invited_email, participation_bps, expires_at, offer_id").single();
    if (error) throw error;

    const invitationUrl = new URL(
      `/convites/coproducao?token=${token}`,
      requireEnv(env.appUrl, "NEXT_PUBLIC_APP_URL"),
    ).toString();
    const participationPercent = new Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(participationBps / 100) + "%";
    const scopeLabel = offerId
      ? (offerResult.data?.name ? `Oferta: ${offerResult.data.name}` : "Oferta específica")
      : "Produto inteiro";

    try {
      await sendCoproducerInvitationEmail({
        to: email,
        name: profile?.full_name || email.split("@")[0] || "parceiro",
        productName: product?.name || "Produto Prosperity Pay",
        participationPercent,
        scopeLabel,
        link: invitationUrl,
      });
    } catch (emailError) {
      await admin.from("coproducer_invitations").delete().eq("id", data.id);
      throw emailError;
    }

    return NextResponse.json({
      invitation: data,
      invitationUrl,
      emailSent: true,
    }, { status: 201 });
  } catch (error) { return jsonError(error); }
}
