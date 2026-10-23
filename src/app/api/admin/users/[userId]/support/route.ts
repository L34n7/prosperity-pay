import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import {
  SUPPORT_AUTH_COOKIE,
  SUPPORT_MODE_COOKIE,
  SUPPORT_SESSION_SECONDS,
} from "@/lib/auth/support-mode";
import { requirePlatformAdmin } from "@/lib/auth/require-user";
import { env, requireEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.current.types";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ userId: string }> },
) {
  const { user: adminUser } = await requirePlatformAdmin();
  const { userId } = await context.params;
  const admin = createAdminClient();

  if (userId === adminUser.id) {
    return NextResponse.json(
      { error: "Você já está acessando sua própria conta." },
      { status: 400 },
    );
  }

  const target = await admin.auth.admin.getUserById(userId);
  if (target.error || !target.data.user?.email) {
    return NextResponse.json(
      { error: "Usuário não encontrado." },
      { status: 404 },
    );
  }

  const generated = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: target.data.user.email,
  });

  const tokenHash = generated.data.properties?.hashed_token;
  if (generated.error || !tokenHash) {
    console.error("[SUPPORT_MODE] Falha ao gerar sessão.", generated.error);
    return NextResponse.json(
      { error: "Não foi possível iniciar o modo suporte." },
      { status: 500 },
    );
  }

  let response = NextResponse.json({
    ok: true,
    redirectUrl: "/dashboard?modo_suporte=1",
  });

  const supportClient = createServerClient<Database>(
    requireEnv(env.supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv(env.supabaseAnonKey, "NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookieOptions: {
        name: SUPPORT_AUTH_COOKIE,
        maxAge: SUPPORT_SESSION_SECONDS,
        path: "/",
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet, headers) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, {
              ...options,
              maxAge: SUPPORT_SESSION_SECONDS,
              path: "/",
            });
          });
          Object.entries(headers).forEach(([key, value]) => {
            response.headers.set(key, value);
          });
        },
      },
    },
  );

  const verified = await supportClient.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });

  if (verified.error || !verified.data.user) {
    console.error("[SUPPORT_MODE] Falha ao autenticar sessão.", verified.error);
    return NextResponse.json(
      { error: "Não foi possível autenticar o modo suporte." },
      { status: 500 },
    );
  }

  response.cookies.set(SUPPORT_MODE_COOKIE, "1", {
    maxAge: SUPPORT_SESSION_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  await admin
    .from("audit_events")
    .insert({
      actor_user_id: adminUser.id,
      action: "support_mode.started",
      entity_type: "user",
      entity_id: userId,
      metadata: {
        target_email: target.data.user.email,
        read_only: true,
        expires_in_seconds: SUPPORT_SESSION_SECONDS,
      },
    })
    .then(() => undefined, () => undefined);

  return response;
}
