import { createHmac, randomBytes } from "crypto";
import { env } from "@/lib/env";
import { decryptSecret, encryptSecret } from "@/lib/security/secrets";
import { createAdminClient } from "@/lib/supabase/admin";

export const CRM_PROSPERITY_INTEGRATION_KEY = "crm_prosperity";
export const DEFAULT_CRM_PROSPERITY_WEBHOOK_URL = "https://crmprosperity.com/api/webhooks/prosperity-pay";

type AdminClient = ReturnType<typeof createAdminClient>;

type ManagedIntegrationRow = {
  id: string;
  integration_key: string;
  name: string;
  webhook_url: string;
  secret_encrypted: string;
  secret_last_four: string;
  status: "pending" | "active" | "disconnected";
  created_by: string | null;
  last_updated_by: string | null;
  last_tested_at: string | null;
  last_test_status: "success" | "failed" | null;
  last_test_http_status: number | null;
  last_test_message: string | null;
  disconnected_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CrmProsperityRuntimeConfig = {
  configured: boolean;
  active: boolean;
  source: "database" | "environment" | "none";
  name: string;
  webhookUrl?: string;
  secret?: string;
  secretLastFour?: string;
  status?: "pending" | "active" | "disconnected";
};

function integrationTable(admin: AdminClient) {
  return (admin as any).from("platform_integrations");
}

export async function getManagedCrmProsperityIntegration(admin: AdminClient) {
  const { data, error } = await integrationTable(admin)
    .select("*")
    .eq("integration_key", CRM_PROSPERITY_INTEGRATION_KEY)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as ManagedIntegrationRow | null;
}

export async function getCrmProsperityRuntimeConfig(admin: AdminClient): Promise<CrmProsperityRuntimeConfig> {
  const managed = await getManagedCrmProsperityIntegration(admin);
  if (managed) {
    if (managed.status !== "active") {
      return {
        configured: true,
        active: false,
        source: "database",
        name: managed.name,
        webhookUrl: managed.webhook_url,
        secretLastFour: managed.secret_last_four,
        status: managed.status,
      };
    }

    return {
      configured: true,
      active: true,
      source: "database",
      name: managed.name,
      webhookUrl: managed.webhook_url,
      secret: decryptSecret(managed.secret_encrypted),
      secretLastFour: managed.secret_last_four,
      status: managed.status,
    };
  }

  if (env.crmProsperityWebhookUrl && env.crmProsperityWebhookSecret) {
    return {
      configured: true,
      active: true,
      source: "environment",
      name: "CRM Prosperity",
      webhookUrl: env.crmProsperityWebhookUrl,
      secret: env.crmProsperityWebhookSecret,
      secretLastFour: env.crmProsperityWebhookSecret.slice(-4),
    };
  }

  return {
    configured: false,
    active: false,
    source: "none",
    name: "CRM Prosperity",
  };
}

export function generateCrmProsperitySecret() {
  return randomBytes(32).toString("hex");
}

export function encryptCrmProsperitySecret(secret: string) {
  return encryptSecret(secret);
}

export function signCrmProsperityPayload(rawBody: string, timestamp: string, secret: string) {
  return `sha256=${createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex")}`;
}

export function validateCrmProsperityWebhookUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("URL do webhook inválida.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("O webhook do CRM Prosperity deve usar HTTPS.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("A URL do webhook não pode conter credenciais.");
  }
  return parsed.toString();
}
