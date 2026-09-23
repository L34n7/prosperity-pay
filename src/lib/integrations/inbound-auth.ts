import { createHmac, timingSafeEqual } from "node:crypto";
import { HttpError } from "@/lib/api/http";
import { decryptSecret } from "@/lib/security/secrets";
import { createAdminClient } from "@/lib/supabase/admin";

const MAX_CLOCK_SKEW_SECONDS = 300;

function envPrefix(integrationKey: string) {
  return integrationKey.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

async function resolveSecret(integrationKey: string) {
  const admin = createAdminClient();
  const { data, error } = await (admin as any).from("platform_integrations")
    .select("secret_encrypted,status")
    .eq("integration_key", integrationKey)
    .maybeSingle();
  if (error) throw error;
  if (data) {
    if (data.status !== "active") throw new HttpError(403, "Integração inativa.");
    return decryptSecret(data.secret_encrypted);
  }

  const secret = process.env[`${envPrefix(integrationKey)}_WEBHOOK_SECRET`]?.trim();
  if (!secret) throw new HttpError(401, "Integração não configurada.");
  return secret;
}

function sameSignature(received: string, expected: string) {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function requireSignedIntegrationRequest(request: Request, rawBody: string) {
  const integrationKey = request.headers.get("x-prosperity-integration")?.trim();
  const timestamp = request.headers.get("x-prosperity-timestamp")?.trim();
  const signature = request.headers.get("x-prosperity-signature")?.trim();

  if (!integrationKey || !timestamp || !signature) {
    throw new HttpError(401, "Assinatura da integração ausente.");
  }

  const unixSeconds = Number(timestamp);
  if (!Number.isSafeInteger(unixSeconds)) throw new HttpError(401, "Timestamp inválido.");
  const skew = Math.abs(Math.floor(Date.now() / 1000) - unixSeconds);
  if (skew > MAX_CLOCK_SKEW_SECONDS) throw new HttpError(401, "Assinatura expirada.");

  const secret = await resolveSecret(integrationKey);
  const expected = `sha256=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
  if (!sameSignature(signature, expected)) throw new HttpError(401, "Assinatura inválida.");

  return { integrationKey };
}
