import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { sha256 } from "@/lib/security/hash";

export const PIX_SECURITY_DURATION_MINUTES = 10;
export const PIX_SECURITY_MAX_ATTEMPTS = 5;

export function pixSecurityCodeHash(params: {
  challengeId: string;
  userId: string;
  code: string;
}) {
  return sha256(`${params.challengeId}:${params.userId}:${params.code}`);
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function verifyAndConsumePixSecurityChallenge(params: {
  userId: string;
  challengeId: string;
  code: string;
  action: "create" | "update";
  targetPayoutAccountId?: string | null;
}) {
  const code = params.code.trim();
  if (!/^\d{6}$/.test(code)) {
    throw new Error("Código de confirmação inválido.");
  }

  const admin = createAdminClient();
  const table = (admin as any).from("payout_security_challenges");
  const { data: challenge, error } = await table
    .select(
      "id,user_id,action,target_payout_account_id,code_hash,expires_at,attempts,max_attempts,used_at,invalidated_at",
    )
    .eq("id", params.challengeId)
    .eq("user_id", params.userId)
    .maybeSingle();

  if (error) throw error;
  if (!challenge || challenge.used_at || challenge.invalidated_at) {
    throw new Error("Confirmação de segurança inválida ou já utilizada.");
  }
  if (challenge.action !== params.action) {
    throw new Error("Confirmação de segurança não corresponde a esta operação.");
  }

  const expectedTarget = params.targetPayoutAccountId ?? null;
  if ((challenge.target_payout_account_id ?? null) !== expectedTarget) {
    throw new Error("Confirmação de segurança não corresponde a esta chave Pix.");
  }

  if (new Date(challenge.expires_at).getTime() <= Date.now()) {
    throw new Error("O código expirou. Solicite um novo código.");
  }
  if (Number(challenge.attempts) >= Number(challenge.max_attempts)) {
    throw new Error("Limite de tentativas excedido. Solicite um novo código.");
  }

  const expectedHash = pixSecurityCodeHash({
    challengeId: challenge.id,
    userId: params.userId,
    code,
  });

  if (!safeEqual(expectedHash, challenge.code_hash)) {
    const attempts = Number(challenge.attempts) + 1;
    await table
      .update({
        attempts,
        invalidated_at:
          attempts >= Number(challenge.max_attempts)
            ? new Date().toISOString()
            : null,
      })
      .eq("id", challenge.id);

    throw new Error(
      attempts >= Number(challenge.max_attempts)
        ? "Código incorreto. Limite de tentativas excedido; solicite um novo código."
        : "Código de confirmação incorreto.",
    );
  }

  const now = new Date().toISOString();
  const { data: consumed, error: consumeError } = await table
    .update({ used_at: now })
    .eq("id", challenge.id)
    .is("used_at", null)
    .is("invalidated_at", null)
    .select("id")
    .maybeSingle();

  if (consumeError) throw consumeError;
  if (!consumed) {
    throw new Error("Este código já foi utilizado. Solicite um novo código.");
  }
}
