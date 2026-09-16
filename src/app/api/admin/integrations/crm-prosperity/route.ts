import { NextResponse } from "next/server";
import { asObject, HttpError, jsonError, requiredString } from "@/lib/api/http";
import { requirePlatformAdmin } from "@/lib/auth/require-user";
import {
  CRM_PROSPERITY_INTEGRATION_KEY,
  encryptCrmProsperitySecret,
  generateCrmProsperitySecret,
  getManagedCrmProsperityIntegration,
  validateCrmProsperityWebhookUrl,
} from "@/lib/integrations/crm-prosperity-config";
import { createAdminClient } from "@/lib/supabase/admin";

function integrationTable() {
  return (createAdminClient() as any).from("platform_integrations");
}

function safeWebhookUrl(value: string) {
  try {
    return validateCrmProsperityWebhookUrl(value);
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "URL do webhook inválida.");
  }
}

function publicIntegration(row: any) {
  return {
    id: row.id,
    name: row.name,
    webhookUrl: row.webhook_url,
    status: row.status,
    secretLastFour: row.secret_last_four,
    lastTestedAt: row.last_tested_at,
    lastTestStatus: row.last_test_status,
    lastTestHttpStatus: row.last_test_http_status,
    lastTestMessage: row.last_test_message,
    disconnectedAt: row.disconnected_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function POST(request: Request) {
  try {
    const { user } = await requirePlatformAdmin();
    const body = asObject(await request.json());
    const name = requiredString(body, "name", 80);
    const webhookUrl = safeWebhookUrl(requiredString(body, "webhookUrl", 2048));
    const admin = createAdminClient();
    const existing = await getManagedCrmProsperityIntegration(admin);
    if (existing) throw new HttpError(409, "A integração com o CRM Prosperity já foi criada.");

    const secret = generateCrmProsperitySecret();
    const { data, error } = await integrationTable()
      .insert({
        integration_key: CRM_PROSPERITY_INTEGRATION_KEY,
        name,
        webhook_url: webhookUrl,
        secret_encrypted: encryptCrmProsperitySecret(secret),
        secret_last_four: secret.slice(-4),
        status: "pending",
        created_by: user.id,
        last_updated_by: user.id,
      })
      .select("*")
      .single();
    if (error?.code === "23505") throw new HttpError(409, "A integração com o CRM Prosperity já foi criada.");
    if (error || !data) throw error ?? new Error("Falha ao criar integração.");

    return NextResponse.json({ integration: publicIntegration(data), secret }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { user } = await requirePlatformAdmin();
    const body = asObject(await request.json());
    const name = requiredString(body, "name", 80);
    const webhookUrl = safeWebhookUrl(requiredString(body, "webhookUrl", 2048));

    const admin = createAdminClient();
    const existing = await getManagedCrmProsperityIntegration(admin);
    if (!existing) throw new HttpError(404, "Integração com o CRM Prosperity não encontrada.");
    const urlChanged = existing.webhook_url !== webhookUrl;

    const { data, error } = await integrationTable()
      .update({
        name,
        webhook_url: webhookUrl,
        status: existing.status === "disconnected" ? "disconnected" : (urlChanged ? "pending" : existing.status),
        last_tested_at: urlChanged ? null : existing.last_tested_at,
        last_test_status: urlChanged ? null : existing.last_test_status,
        last_test_http_status: urlChanged ? null : existing.last_test_http_status,
        last_test_message: urlChanged ? null : existing.last_test_message,
        last_updated_by: user.id,
        updated_at: new Date().toISOString(),
      })
      .eq("integration_key", CRM_PROSPERITY_INTEGRATION_KEY)
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new HttpError(404, "Integração com o CRM Prosperity não encontrada.");

    return NextResponse.json({ integration: publicIntegration(data) });
  } catch (error) {
    return jsonError(error);
  }
}
