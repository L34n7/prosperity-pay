import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { asObject, jsonError, requiredString } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/require-user";
import { createAdminClient } from "@/lib/supabase/admin";

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
    const admin = createAdminClient();

    const { data: program, error: programError } = await admin.from("affiliate_programs")
      .select("id, mode, active")
      .eq("product_id", productId)
      .maybeSingle();
    if (programError) throw programError;
    if (!program || !program.active || program.mode !== "invite") {
      return NextResponse.json({ error: "Ative o programa no modo Convite antes de convidar afiliados." }, { status: 409 });
    }

    const { data: profile, error: profileError } = await admin.from("profiles")
      .select("id, email, full_name")
      .ilike("email", email)
      .maybeSingle();
    if (profileError) throw profileError;
    if (!profile) {
      return NextResponse.json({ error: "Nenhuma conta Prosperity Pay foi encontrada com este e-mail. O afiliado precisa se cadastrar antes do convite." }, { status: 404 });
    }
    if (profile.id === user.id) {
      return NextResponse.json({ error: "O produtor não pode se convidar como afiliado do próprio produto." }, { status: 409 });
    }

    const { data: existing, error: existingError } = await admin.from("affiliate_memberships")
      .select("id, code, status")
      .eq("program_id", program.id)
      .eq("user_id", profile.id)
      .maybeSingle();
    if (existingError) throw existingError;

    if (existing?.status === "active") {
      return NextResponse.json({ error: "Este usuário já é afiliado ativo deste produto." }, { status: 409 });
    }
    if (existing?.status === "blocked") {
      return NextResponse.json({ error: "Este afiliado está bloqueado. Desbloqueie-o antes de enviar um novo convite." }, { status: 409 });
    }

    let membership: { id: string; code: string; status: string };
    if (existing?.status === "pending") {
      membership = existing;
    } else if (existing) {
      const code = createCode(email);
      const { data, error } = await admin.from("affiliate_memberships").update({
        code,
        status: "pending",
        invited_by: user.id,
        approved_by: null,
        approved_at: null,
      }).eq("id", existing.id).select("id, code, status").single();
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
      }).select("id, code, status").single();
      if (error) throw error;
      membership = data;
    }

    return NextResponse.json({
      membership,
      invited: { full_name: profile.full_name, email: profile.email },
      invitationPath: `/convites/afiliacao?code=${encodeURIComponent(membership.code)}`,
    }, { status: existing?.status === "pending" ? 200 : 201 });
  } catch (error) {
    return jsonError(error);
  }
}
