import { NextResponse } from "next/server";
import { asObject, jsonError, requiredString } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/require-user";
import {
  isValidCnpj,
  isValidCpf,
  onlyDigits,
} from "@/lib/validation/br-documents";
import { sha256 } from "@/lib/security/hash";
import { decryptSecret, encryptSecret } from "@/lib/security/secrets";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyFinanceAdmins } from "@/lib/email/financial-review";
import { pixKeyTypeLabel } from "@/lib/financial/pix-labels";
import { verifyAndConsumePixSecurityChallenge } from "@/lib/security/pix-security";
import type { Database } from "@/lib/supabase/database.types";

type PixType = Database["public"]["Enums"]["payout_account_type"];
const PIX_TYPES = new Set<PixType>(["cpf", "cnpj", "email", "phone", "random_key"]);

function validPixKey(type: PixType, value: string) {
  if (type === "cpf") return isValidCpf(value);
  if (type === "cnpj") return isValidCnpj(value);
  if (type === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  if (type === "phone") {
    const number = onlyDigits(value);
    return number.length >= 10 && number.length <= 13;
  }
  return value.trim().length >= 20 && value.trim().length <= 180;
}

export async function GET() {
  try {
    const { user } = await requireUser();
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("payout_accounts")
      .select(
        "id,key_type,key_last4,encrypted_key,holder_name,holder_tax_id_last4,holder_tax_id_encrypted,status,is_primary,created_at,updated_at",
      )
      .eq("user_id", user.id)
      .neq("status", "disabled")
      .order("created_at", { ascending: false });

    if (error) throw error;

    const payoutAccounts = (data ?? []).map((item) => ({
      id: item.id,
      key_type: item.key_type,
      key_last4: item.key_last4,
      key_value: decryptSecret(item.encrypted_key),
      holder_name: item.holder_name,
      holder_tax_id_last4: item.holder_tax_id_last4,
      holder_tax_id_value: item.holder_tax_id_encrypted
        ? decryptSecret(item.holder_tax_id_encrypted)
        : null,
      status: item.status,
      is_primary: item.is_primary,
      created_at: item.created_at,
      updated_at: item.updated_at,
    }));

    return NextResponse.json({ payoutAccounts });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user } = await requireUser();
    const body = asObject(await request.json());
    const keyType = body.keyType as PixType;

    if (!PIX_TYPES.has(keyType)) {
      return NextResponse.json({ error: "Tipo de chave Pix inválido." }, { status: 400 });
    }

    const pixKey = requiredString(body, "pixKey", 180).trim();
    const holderName = requiredString(body, "holderName", 180).trim();
    const holderTaxId = onlyDigits(requiredString(body, "holderTaxId", 20));
    const securityChallengeId = requiredString(body, "securityChallengeId", 36);
    const securityCode = requiredString(body, "securityCode", 6);

    if (
      !(
        (holderTaxId.length === 11 && isValidCpf(holderTaxId)) ||
        (holderTaxId.length === 14 && isValidCnpj(holderTaxId))
      )
    ) {
      return NextResponse.json(
        { error: "CPF/CNPJ do titular inválido." },
        { status: 400 },
      );
    }

    const normalizedKey = ["cpf", "cnpj", "phone"].includes(keyType)
      ? onlyDigits(pixKey)
      : pixKey.toLowerCase();

    if (!validPixKey(keyType, normalizedKey)) {
      const labels: Record<PixType, string> = {
        cpf: "CPF",
        cnpj: "CNPJ",
        email: "e-mail",
        phone: "telefone",
        random_key: "chave aleatória",
      };
      return NextResponse.json(
        { error: `${labels[keyType]} informado como chave Pix é inválido.` },
        { status: 400 },
      );
    }

    const admin = createAdminClient();

    const { data: duplicate, error: duplicateError } = await admin
      .from("payout_accounts")
      .select("id,status")
      .eq("user_id", user.id)
      .eq("key_hash", sha256(normalizedKey))
      .neq("status", "disabled")
      .maybeSingle();

    if (duplicateError) throw duplicateError;
    if (duplicate) {
      return NextResponse.json(
        { error: "Essa chave Pix já está cadastrada na sua conta." },
        { status: 409 },
      );
    }

    await verifyAndConsumePixSecurityChallenge({
      userId: user.id,
      challengeId: securityChallengeId,
      code: securityCode,
      action: "create",
      targetPayoutAccountId: null,
    });

    const { data, error } = await admin
      .from("payout_accounts")
      .insert({
        user_id: user.id,
        key_type: keyType,
        key_last4: normalizedKey.slice(-4),
        key_hash: sha256(normalizedKey),
        encrypted_key: encryptSecret(normalizedKey),
        holder_name: holderName,
        holder_tax_id_last4: holderTaxId.slice(-4),
        holder_tax_id_encrypted: encryptSecret(holderTaxId),
        is_primary: Boolean(body.isPrimary),
      })
      .select(
        "id,key_type,key_last4,holder_name,holder_tax_id_last4,status,is_primary,created_at",
      )
      .single();

    if (error) throw error;

    await notifyFinanceAdmins({
      requesterUserId: user.id,
      kind: "pix",
      details: [
        { label: "Tipo da chave", value: pixKeyTypeLabel(keyType) },
        { label: "Chave", value: `•••• ${normalizedKey.slice(-4)}` },
        { label: "Titular", value: holderName },
        { label: "CPF/CNPJ do titular", value: `•••• ${holderTaxId.slice(-4)}` },
      ],
    });

    return NextResponse.json(
      {
        payoutAccount: {
          ...data,
          key_value: normalizedKey,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return jsonError(error);
  }
}


export async function PATCH(request: Request) {
  try {
    const { user } = await requireUser();
    const body = asObject(await request.json());
    const id = requiredString(body, "id", 36);
    const keyType = body.keyType as PixType;

    if (!PIX_TYPES.has(keyType)) {
      return NextResponse.json({ error: "Tipo de chave Pix inválido." }, { status: 400 });
    }

    const pixKey = requiredString(body, "pixKey", 180).trim();
    const holderName = requiredString(body, "holderName", 180).trim();
    const holderTaxId = onlyDigits(requiredString(body, "holderTaxId", 20));
    const securityChallengeId = requiredString(body, "securityChallengeId", 36);
    const securityCode = requiredString(body, "securityCode", 6);

    if (
      !(
        (holderTaxId.length === 11 && isValidCpf(holderTaxId)) ||
        (holderTaxId.length === 14 && isValidCnpj(holderTaxId))
      )
    ) {
      return NextResponse.json(
        { error: "CPF/CNPJ do titular inválido." },
        { status: 400 },
      );
    }

    const normalizedKey = ["cpf", "cnpj", "phone"].includes(keyType)
      ? onlyDigits(pixKey)
      : pixKey.toLowerCase();

    if (!validPixKey(keyType, normalizedKey)) {
      return NextResponse.json({ error: "Chave Pix inválida." }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: existing, error: existingError } = await admin
      .from("payout_accounts")
      .select("id,status")
      .eq("id", id)
      .eq("user_id", user.id)
      .neq("status", "disabled")
      .maybeSingle();

    if (existingError) throw existingError;
    if (!existing) {
      return NextResponse.json({ error: "Chave Pix não encontrada." }, { status: 404 });
    }
    if (!["pending", "rejected"].includes(existing.status)) {
      return NextResponse.json(
        { error: "Somente chaves em análise ou rejeitadas podem ser editadas." },
        { status: 409 },
      );
    }

    const { data: duplicate, error: duplicateError } = await admin
      .from("payout_accounts")
      .select("id")
      .eq("user_id", user.id)
      .eq("key_hash", sha256(normalizedKey))
      .neq("id", id)
      .neq("status", "disabled")
      .maybeSingle();

    if (duplicateError) throw duplicateError;
    if (duplicate) {
      return NextResponse.json(
        { error: "Essa chave Pix já está cadastrada na sua conta." },
        { status: 409 },
      );
    }

    await verifyAndConsumePixSecurityChallenge({
      userId: user.id,
      challengeId: securityChallengeId,
      code: securityCode,
      action: "update",
      targetPayoutAccountId: id,
    });

    const { data, error } = await admin
      .from("payout_accounts")
      .update({
        key_type: keyType,
        key_last4: normalizedKey.slice(-4),
        key_hash: sha256(normalizedKey),
        encrypted_key: encryptSecret(normalizedKey),
        holder_name: holderName,
        holder_tax_id_last4: holderTaxId.slice(-4),
        holder_tax_id_encrypted: encryptSecret(holderTaxId),
        status: "pending",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", user.id)
      .select(
        "id,key_type,key_last4,holder_name,holder_tax_id_last4,status,is_primary,created_at,updated_at",
      )
      .single();

    if (error) throw error;

    await notifyFinanceAdmins({
      requesterUserId: user.id,
      kind: "pix",
      details: [
        { label: "Tipo da chave", value: pixKeyTypeLabel(keyType) },
        { label: "Chave", value: `•••• ${normalizedKey.slice(-4)}` },
        { label: "Titular", value: holderName },
        { label: "CPF/CNPJ do titular", value: `•••• ${holderTaxId.slice(-4)}` },
      ],
    });

    return NextResponse.json({
      payoutAccount: {
        ...data,
        key_value: normalizedKey,
        holder_tax_id_value: holderTaxId,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
