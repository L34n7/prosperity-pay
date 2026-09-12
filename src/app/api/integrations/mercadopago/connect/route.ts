import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/require-user";
import { env, requireEnv } from "@/lib/env";

export async function GET() {
  try {
    await requireUser();
    const state = randomBytes(24).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const url = new URL("https://auth.mercadopago.com.br/authorization");
    url.searchParams.set("client_id", requireEnv(env.mercadoPagoClientId, "MERCADO_PAGO_CLIENT_ID"));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("platform_id", "mp");
    url.searchParams.set("redirect_uri", requireEnv(env.mercadoPagoRedirectUri, "MERCADO_PAGO_REDIRECT_URI"));
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");

    const response = NextResponse.redirect(url);
    const options = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: 600 };
    response.cookies.set("mp_oauth_state", state, options);
    response.cookies.set("mp_oauth_verifier", verifier, options);
    return response;
  } catch (error) { return jsonError(error); }
}
