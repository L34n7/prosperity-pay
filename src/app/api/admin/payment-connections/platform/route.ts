import { NextResponse } from "next/server";
import { asObject, jsonError, requiredString } from "@/lib/api/http";
import { requireFinanceAdmin } from "@/lib/auth/require-user";
import { env, requireEnv } from "@/lib/env";
import { encryptSecret } from "@/lib/security/secrets";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  try {
    await requireFinanceAdmin();
    const body = asObject(await request.json());
    const externalAccountId = requiredString(body, "externalAccountId", 100);
    const { data, error } = await createAdminClient().rpc("upsert_payment_provider_connection", {
      target_owner_user_id: null,
      target_connection_kind: "prosperity_balance",
      target_external_account_id: externalAccountId,
      target_public_key: null,
      target_scopes: ["payments", "write"],
      target_live_mode: process.env.NODE_ENV === "production",
      target_token_expires_at: new Date("9999-12-31T23:59:59Z").toISOString(),
      target_encrypted_access_token: encryptSecret(requireEnv(env.mercadoPagoAccessToken, "MERCADO_PAGO_ACCESS_TOKEN")),
      target_encrypted_refresh_token: null,
    });
    if (error) throw error;
    return NextResponse.json({ connectionId: data }, { status: 201 });
  } catch (error) { return jsonError(error); }
}
