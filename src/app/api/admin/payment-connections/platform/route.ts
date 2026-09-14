import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api/http";
import { requirePlatformAdmin } from "@/lib/auth/require-user";
import { env, requireEnv } from "@/lib/env";
import { encryptSecret } from "@/lib/security/secrets";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST() {
  try {
    await requirePlatformAdmin();
    const accessToken = requireEnv(env.mercadoPagoAccessToken, "MERCADO_PAGO_ACCESS_TOKEN");
    const accountResponse = await fetch("https://api.mercadopago.com/users/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    });
    const account = await accountResponse.json() as { id?: number; nickname?: string; message?: string };
    if (!accountResponse.ok) return NextResponse.json({ error: account.message || "Credencial da conta Prosperity inválida." }, { status: 502 });
    if (!account.id) return NextResponse.json({ error: "Não foi possível identificar a conta Prosperity." }, { status: 502 });

    const { data, error } = await createAdminClient().rpc("upsert_payment_provider_connection", {
      target_owner_user_id: null,
      target_connection_kind: "prosperity_balance",
      target_external_account_id: String(account.id),
      target_public_key: null,
      target_scopes: ["payments", "write"],
      target_live_mode: process.env.NODE_ENV === "production",
      target_token_expires_at: new Date("9999-12-31T23:59:59Z").toISOString(),
      target_encrypted_access_token: encryptSecret(accessToken),
      target_encrypted_refresh_token: null,
    });
    if (error) throw error;

    return NextResponse.json({ connectionId: data, accountId: String(account.id), nickname: account.nickname ?? null }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
