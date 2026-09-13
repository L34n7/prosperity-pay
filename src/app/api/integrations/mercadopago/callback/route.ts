import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { HttpError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/require-user";
import { env, requireEnv } from "@/lib/env";
import { encryptSecret } from "@/lib/security/secrets";
import { createAdminClient } from "@/lib/supabase/admin";

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  public_key?: string;
  user_id?: number;
  expires_in?: number;
  scope?: string;
  live_mode?: boolean;
  message?: string;
};

export async function GET(request: Request) {
  try {
    const { user } = await requireUser();
    const requestUrl = new URL(request.url);
    const code = requestUrl.searchParams.get("code");
    const state = requestUrl.searchParams.get("state");
    const cookieStore = await cookies();
    const expectedState = cookieStore.get("mp_oauth_state")?.value;
    const verifier = cookieStore.get("mp_oauth_verifier")?.value;
    if (!code || !state || !expectedState || state !== expectedState || !verifier) {
      throw new HttpError(400, "Retorno OAuth invalido ou expirado.");
    }

    const response = await fetch("https://api.mercadopago.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: requireEnv(env.mercadoPagoClientId, "MERCADO_PAGO_CLIENT_ID"),
        client_secret: requireEnv(env.mercadoPagoClientSecret, "MERCADO_PAGO_CLIENT_SECRET"),
        code,
        redirect_uri: requireEnv(env.mercadoPagoRedirectUri, "MERCADO_PAGO_REDIRECT_URI"),
        code_verifier: verifier,
      }),
      cache: "no-store",
    });
    const token = await response.json() as TokenResponse;
    if (!response.ok || !token.access_token || !token.user_id) {
      throw new HttpError(502, token.message || "Mercado Pago recusou a autorizacao.");
    }

    const { error } = await createAdminClient().rpc("upsert_payment_provider_connection", {
      target_owner_user_id: user.id,
      target_connection_kind: "connected_account",
      target_external_account_id: String(token.user_id),
      target_public_key: token.public_key ?? null,
      target_scopes: token.scope?.split(" ").filter(Boolean) ?? [],
      target_live_mode: Boolean(token.live_mode),
      target_token_expires_at: new Date(Date.now() + (token.expires_in ?? 15_552_000) * 1000).toISOString(),
      target_encrypted_access_token: encryptSecret(token.access_token),
      target_encrypted_refresh_token: token.refresh_token ? encryptSecret(token.refresh_token) : null,
    });
    if (error) throw error;

    cookieStore.delete("mp_oauth_state");
    cookieStore.delete("mp_oauth_verifier");
    return NextResponse.redirect(new URL("/integracoes?mercadopago=connected", requestUrl.origin));
  } catch (error) { return jsonError(error); }
}
