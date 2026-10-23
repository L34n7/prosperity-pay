import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function validToken(token: string | null): token is string {
  return Boolean(
    token &&
      token.length >= 32 &&
      token.length <= 128 &&
      /^[A-Za-z0-9_-]+$/.test(token),
  );
}

function unavailable(request: NextRequest) {
  return NextResponse.redirect(
    new URL("/login?erro=acesso_temporario", request.url),
  );
}

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token")?.trim() ?? null;

  if (!validToken(token)) {
    return unavailable(request);
  }

  const admin = createAdminClient();
  const tokenHash = hashToken(token);
  const now = new Date().toISOString();

  const { data: access, error: accessError } = await admin
    .from("admin_temporary_access_tokens")
    .select("id,target_user_id,target_email,expires_at,used_at")
    .eq("token_hash", tokenHash)
    .is("used_at", null)
    .gt("expires_at", now)
    .maybeSingle();

  if (accessError) {
    console.error("[TEMP_ACCESS] Falha ao validar token.", accessError);
    return unavailable(request);
  }

  if (!access) {
    return unavailable(request);
  }

  const userResult = await admin.auth.admin.getUserById(access.target_user_id);

  if (userResult.error || !userResult.data.user?.email) {
    console.error("[TEMP_ACCESS] Usuário alvo não encontrado.", {
      tokenId: access.id,
      error: userResult.error?.message,
    });
    return unavailable(request);
  }

  const generated = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: userResult.data.user.email,
  });

  const otpHash = generated.data.properties?.hashed_token;
  if (generated.error || !otpHash) {
    console.error("[TEMP_ACCESS] Falha ao gerar sessão temporária.", {
      tokenId: access.id,
      error: generated.error?.message,
    });
    return unavailable(request);
  }

  const { data: claimed, error: claimError } = await admin
    .from("admin_temporary_access_tokens")
    .update({ used_at: now })
    .eq("id", access.id)
    .is("used_at", null)
    .gt("expires_at", now)
    .select("id")
    .maybeSingle();

  if (claimError || !claimed) {
    console.warn("[TEMP_ACCESS] Token já utilizado ou expirado.", {
      tokenId: access.id,
    });
    return unavailable(request);
  }

  const confirm = new URL("/auth/confirm", request.url);
  confirm.searchParams.set("token_hash", otpHash);
  confirm.searchParams.set("type", "magiclink");
  confirm.searchParams.set("next", "/dashboard");

  const response = NextResponse.redirect(confirm);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
