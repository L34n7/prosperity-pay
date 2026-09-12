import { NextResponse } from "next/server";
import { asObject, jsonError, requiredString } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/require-user";
import { digits, sha256 } from "@/lib/security/hash";
import { encryptSecret } from "@/lib/security/secrets";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";

type PixType = Database["public"]["Enums"]["payout_account_type"];
const PIX_TYPES = new Set<PixType>(["cpf", "cnpj", "email", "phone", "random_key"]);

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const { data, error } = await supabase.from("payout_accounts")
      .select("id, key_type, key_last4, holder_name, holder_tax_id_last4, status, is_primary, created_at")
      .eq("user_id", user.id).neq("status", "disabled").order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ payoutAccounts: data });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    const { user } = await requireUser();
    const body = asObject(await request.json());
    const keyType = body.keyType as PixType;
    if (!PIX_TYPES.has(keyType)) return NextResponse.json({ error: "Tipo de chave Pix invalido." }, { status: 400 });
    const pixKey = requiredString(body, "pixKey", 180).trim();
    const holderName = requiredString(body, "holderName", 180);
    const holderTaxId = digits(requiredString(body, "holderTaxId", 20));
    if (![11, 14].includes(holderTaxId.length)) return NextResponse.json({ error: "Documento do titular invalido." }, { status: 400 });

    const normalizedKey = ["cpf", "cnpj", "phone"].includes(keyType) ? digits(pixKey) : pixKey.toLowerCase();
    const admin = createAdminClient();
    const { data, error } = await admin.from("payout_accounts").insert({
      user_id: user.id,
      key_type: keyType,
      key_last4: normalizedKey.slice(-4),
      key_hash: sha256(normalizedKey),
      encrypted_key: encryptSecret(normalizedKey),
      holder_name: holderName,
      holder_tax_id_last4: holderTaxId.slice(-4),
      is_primary: Boolean(body.isPrimary),
    }).select("id, key_type, key_last4, status, is_primary").single();
    if (error) throw error;
    return NextResponse.json({ payoutAccount: data }, { status: 201 });
  } catch (error) { return jsonError(error); }
}
