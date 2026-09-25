import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { asObject, jsonError, requiredString } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/require-user";
import { env, requireEnv } from "@/lib/env";
import { sendAffiliateInvitationEmail } from "@/lib/email/resend-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchAffiliateMembershipWebhooksSafe } from "@/lib/integrations/affiliate-webhook";
import {
  parseAddonCommissionOverrides,
  parseOfferCommissionOverrides,
  saveAddonCommissionOverrides,
  saveOfferCommissionOverrides,
} from "@/lib/affiliates/offer-commission-overrides";

type Context = { params: Promise<{ productId: string }> };

function createCode(email: string) {
  const prefix = email.split("@")[0]?.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 10) || "AFILIADO";
  return `${prefix}${randomBytes(8).toString("hex").toUpperCase()}`;
}

export async function POST(request: Request, context: Context) {
  try {
    const { productId } = await context.params;
    const { supabase, user } = await requireUser();
    const { data: owns } = await supabase.rpc("owns_product", { target_product_id: productId });
    if (!owns) return NextResponse.json({ error: "Produto não encontrado." }, { status: 404 });

    const body = asObject(await request.json());
    const email = requiredString(body, "email", 320).trim().toLowerCase();
    const partnerType =
      body.partnerType === "accredited" ? "accredited" : "affiliate";
    let offerCommissionOverrides: ReturnType<typeof parseOfferCommissionOverrides> = [];
    let addonCommissionOverrides: ReturnType<typeof parseAddonCommissionOverrides> = [];
    try {
      offerCommissionOverrides = parseOfferCommissionOverrides(body.offerCommissionOverrides);
      addonCommissionOverrides = parseAddonCommissionOverrides(body.addonCommissionOverrides);
    } catch (cause) {
      return NextResponse.json({ error: cause instanceof Error ? cause.message : "Configuração individual inválida." }, { status: 400 });
    }
    const admin = createAdminClient();

    const [{ data: program, error: programError }, { data: product, error: productError }] = await Promise.all([
      admin.from("affiliate_programs")
        .select("id, mode, active")
        .eq("product_id", productId)
        .maybeSingle(),
      admin.from("products")
        .select("name")
        .eq("id", productId)
        .maybeSingle(),
    ]);
    if (programError || productError) throw programError ?? productError;
    if (!program || !program.active || program.mode !== "invite") {
      return NextResponse.json({ error: "Ative o programa no modo Convite antes de convidar parceiros." }, { status: 409 });
    }

    const { data: profile, error: profileError } = await admin.from("profiles")
      .select("id, email, full_name")
      .ilike("email", email)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile) {
      return NextResponse.json({ error: "Nenhuma conta Prosperity Pay foi encontrada com este e-mail. O parceiro precisa se cadastrar antes do convite." }, { status: 404 });
    }
    if (profile.id === user.id) {
      return NextResponse.json({ error: "O produtor não pode se convidar como parceiro do próprio produto." }, { status: 409 });
    }

    const { data: existing, error: existingError } = await admin.from("affiliate_memberships")
      .select("id, code, status, partner_type")
      .eq("program_id", program.id)
      .eq("user_id", profile.id)
      .maybeSingle();
    if (existingError) throw existingError;

    if (existing?.status === "active") {
      return NextResponse.json({ error: "Este usuário já é parceiro ativo deste produto." }, { status: 409 });
    }
    if (existing?.status === "blocked") {
      return NextResponse.json({ error: "Este parceiro está bloqueado. Desbloqueie-o antes de enviar um novo convite." }, { status: 409 });
    }

    let membership: { id: string; code: string; status: string; partner_type: string };
    if (existing?.status === "pending") {
      const { data, error } = await admin.from("affiliate_memberships").update({
        partner_type: partnerType,
        updated_at: new Date().toISOString(),
      }).eq("id", existing.id).select("id, code, status, partner_type").single();
      if (error) throw error;
      membership = data;
    } else if (existing) {
      const code = createCode(email);
      const { data, error } = await admin.from("affiliate_memberships").update({
        code,
        status: "pending",
        invited_by: user.id,
        approved_by: null,
        approved_at: null,
        partner_type: partnerType,
        updated_at: new Date().toISOString(),
      }).eq("id", existing.id).select("id, code, status, partner_type").single();
      if (error) throw error;
      membership = data;
    } else {
      const code = createCode(email);
      const { data, error } = await admin.from("affiliate_memberships").insert({
        program_id: program.id,
        user_id: profile.id,
        code,
        status: "pending",
        invited_by: user.id,
        partner_type: partnerType,
      }).select("id, code, status, partner_type").single();
      if (error) throw error;
      membership = data;
    }

    await Promise.all([
      saveOfferCommissionOverrides({
        admin,
        productId,
        membershipId: membership.id,
        overrides: offerCommissionOverrides,
      }),
      saveAddonCommissionOverrides({
        admin,
        productId,
        membershipId: membership.id,
        overrides: addonCommissionOverrides,
      }),
    ]);

    const invitationPath = `/convites/afiliacao?code=${encodeURIComponent(membership.code)}`;
    const invitationUrl = new URL(
      invitationPath,
      requireEnv(env.appUrl, "NEXT_PUBLIC_APP_URL"),
    ).toString();

    await sendAffiliateInvitationEmail({
      to: profile.email,
      name: profile.full_name || profile.email.split("@")[0] || "parceiro",
      productName: product?.name || "Produto Prosperity Pay",
      link: invitationUrl,
      partnerType,
    });

    await dispatchAffiliateMembershipWebhooksSafe(admin, membership.id);

    return NextResponse.json({
      membership,
      invited: { full_name: profile.full_name, email: profile.email },
      invitationPath,
      invitationUrl,
      emailSent: true,
    }, { status: existing?.status === "pending" ? 200 : 201 });
  } catch (error) {
    return jsonError(error);
  }
}
