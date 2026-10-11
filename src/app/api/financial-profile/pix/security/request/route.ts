import { randomInt } from "node:crypto";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { asObject, jsonError, requiredString } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/require-user";
import { sendPixSecurityCodeEmail } from "@/lib/email/resend-auth";
import { env, requireEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  PIX_SECURITY_DURATION_MINUTES,
  PIX_SECURITY_MAX_ATTEMPTS,
  pixSecurityCodeHash,
} from "@/lib/security/pix-security";

function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const visible = local.slice(0, Math.min(2, local.length));
  const hidden = "•".repeat(Math.max(3, local.length - visible.length));
  return `${visible}${hidden}@${domain}`;
}

export async function POST(request: Request) {
  try {
    const { user } = await requireUser();
    const body = asObject(await request.json());
    const password = requiredString(body, "password", 256);
    const action = requiredString(body, "action", 10);

    if (action !== "create" && action !== "update") {
      return NextResponse.json({ error: "Operação inválida." }, { status: 400 });
    }

    if (!user.email) {
      return NextResponse.json(
        { error: "Sua conta não possui e-mail para confirmação." },
        { status: 400 },
      );
    }

    const payoutAccountId =
      action === "update"
        ? requiredString(body, "payoutAccountId", 36)
        : null;

    const admin = createAdminClient();

    if (payoutAccountId) {
      const { data: payout, error: payoutError } = await admin
        .from("payout_accounts")
        .select("id,status")
        .eq("id", payoutAccountId)
        .eq("user_id", user.id)
        .neq("status", "disabled")
        .maybeSingle();

      if (payoutError) throw payoutError;
      if (!payout) {
        return NextResponse.json(
          { error: "Chave Pix não encontrada." },
          { status: 404 },
        );
      }
      if (!["pending", "rejected"].includes(payout.status)) {
        return NextResponse.json(
          { error: "Somente chaves em análise ou rejeitadas podem ser alteradas." },
          { status: 409 },
        );
      }
    }

    const authClient = createSupabaseClient(
      requireEnv(env.supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL"),
      requireEnv(env.supabaseAnonKey, "NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      },
    );

    const verified = await authClient.auth.signInWithPassword({
      email: user.email,
      password,
    });

    if (verified.error || verified.data.user?.id !== user.id) {
      return NextResponse.json(
        { error: "Senha incorreta. Confira sua senha de login." },
        { status: 401 },
      );
    }

    await authClient.auth.signOut().catch(() => undefined);

    const challengeTable = (admin as any).from("payout_security_challenges");
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { count, error: countError } = await challengeTable
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", since);

    if (countError) throw countError;
    if ((count ?? 0) >= 3) {
      return NextResponse.json(
        {
          error:
            "Muitas solicitações de código em pouco tempo. Aguarde alguns minutos e tente novamente.",
        },
        { status: 429 },
      );
    }

    await challengeTable
      .update({ invalidated_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("purpose", "payout_account")
      .is("used_at", null)
      .is("invalidated_at", null);

    const challengeId = crypto.randomUUID();
    const code = String(randomInt(100000, 1000000));
    const expiresAt = new Date(
      Date.now() + PIX_SECURITY_DURATION_MINUTES * 60 * 1000,
    ).toISOString();

    const { error: insertError } = await challengeTable.insert({
      id: challengeId,
      user_id: user.id,
      email: user.email.toLowerCase(),
      purpose: "payout_account",
      action,
      target_payout_account_id: payoutAccountId,
      code_hash: pixSecurityCodeHash({
        challengeId,
        userId: user.id,
        code,
      }),
      expires_at: expiresAt,
      max_attempts: PIX_SECURITY_MAX_ATTEMPTS,
    });

    if (insertError) throw insertError;

    const profile = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .maybeSingle();

    try {
      await sendPixSecurityCodeEmail({
        to: user.email,
        name:
          profile.data?.full_name ||
          String(user.user_metadata?.full_name || "cliente"),
        code,
        action,
        expiresInMinutes: PIX_SECURITY_DURATION_MINUTES,
      });
    } catch (error) {
      await challengeTable.delete().eq("id", challengeId);
      throw error;
    }

    return NextResponse.json({
      challengeId,
      email: maskEmail(user.email),
      expiresInMinutes: PIX_SECURITY_DURATION_MINUTES,
    });
  } catch (error) {
    return jsonError(error);
  }
}
