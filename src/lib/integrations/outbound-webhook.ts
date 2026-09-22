import { createHmac } from "crypto";
import { decryptSecret } from "@/lib/security/secrets";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";

type AdminClient = ReturnType<typeof createAdminClient>;

type IntegrationRuntime = {
  configured: boolean;
  active: boolean;
  webhookUrl?: string;
  secret?: string;
  status?: string;
};

type DeliveryRow = {
  id: string;
  event_id: string;
  status: "pending" | "delivered" | "failed";
  attempts: number;
};

function integrationTable(admin: AdminClient) {
  return (admin as any).from("platform_integrations");
}

function deliveryTable(admin: AdminClient) {
  return (admin as any).from("integration_webhook_deliveries");
}

function integrationEnvPrefix(integrationKey: string) {
  return integrationKey
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

async function getIntegrationRuntime(admin: AdminClient, integrationKey: string): Promise<IntegrationRuntime> {
  const { data, error } = await integrationTable(admin)
    .select("integration_key,webhook_url,secret_encrypted,status")
    .eq("integration_key", integrationKey)
    .maybeSingle();
  if (error) throw error;

  if (data) {
    if (data.status !== "active") {
      return { configured: true, active: false, status: data.status };
    }

    return {
      configured: true,
      active: true,
      status: data.status,
      webhookUrl: data.webhook_url,
      secret: decryptSecret(data.secret_encrypted),
    };
  }

  // Compatibilidade genérica com integrações configuradas por ambiente.
  // Ex.: integrationKey "crm_prosperity" resolve automaticamente
  // CRM_PROSPERITY_WEBHOOK_URL e CRM_PROSPERITY_WEBHOOK_SECRET, sem
  // conhecimento específico do sistema dentro do motor de webhooks.
  const prefix = integrationEnvPrefix(integrationKey);
  const webhookUrl = process.env[`${prefix}_WEBHOOK_URL`];
  const secret = process.env[`${prefix}_WEBHOOK_SECRET`];

  if (webhookUrl && secret) {
    return {
      configured: true,
      active: true,
      status: "active",
      webhookUrl,
      secret,
    };
  }

  return { configured: false, active: false };
}

function paymentIdForSubject(subjectType: string, subjectId: string) {
  if (subjectType !== "payment") return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subjectId)
    ? subjectId
    : null;
}

function sign(rawBody: string, timestamp: string, secret: string) {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
}

async function getOrCreateDelivery(input: {
  admin: AdminClient;
  integrationKey: string;
  subjectType: string;
  subjectId: string;
  eventType: string;
  payload: Json;
}) {
  const inserted = await deliveryTable(input.admin)
    .insert({
      integration: input.integrationKey,
      payment_id: paymentIdForSubject(input.subjectType, input.subjectId),
      subject_type: input.subjectType,
      subject_id: input.subjectId,
      event_type: input.eventType,
      payload: input.payload,
      status: "pending",
    })
    .select("id,event_id,status,attempts")
    .single();

  if (!inserted.error && inserted.data) return inserted.data as DeliveryRow;
  if (inserted.error?.code !== "23505") throw inserted.error;

  const existing = await deliveryTable(input.admin)
    .select("id,event_id,status,attempts")
    .eq("integration", input.integrationKey)
    .eq("subject_type", input.subjectType)
    .eq("subject_id", input.subjectId)
    .eq("event_type", input.eventType)
    .single();
  if (existing.error || !existing.data) throw existing.error ?? new Error("Entrega de integração não encontrada.");
  return existing.data as DeliveryRow;
}

export async function deliverIntegrationWebhook(input: {
  admin: AdminClient;
  integrationKey: string;
  subjectType: string;
  subjectId: string;
  eventType: string;
  payload: Json;
}) {
  const runtime = await getIntegrationRuntime(input.admin, input.integrationKey);
  if (!runtime.configured) return { sent: false, reason: "integration_not_configured" as const };
  if (!runtime.active) return { sent: false, reason: "integration_inactive" as const };
  if (!runtime.webhookUrl || !runtime.secret) throw new Error(`Integração ${input.integrationKey} está ativa, mas incompleta.`);

  const delivery = await getOrCreateDelivery(input);
  if (delivery.status === "delivered") {
    return { sent: false, reason: "already_delivered" as const, eventId: delivery.event_id };
  }

  const body = JSON.stringify({ event_id: delivery.event_id, ...input.payload as Record<string, unknown> });
  const timestamp = String(Math.floor(Date.now() / 1000));

  let response: Response;
  try {
    response = await fetch(runtime.webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-prosperity-event-id": delivery.event_id,
        "x-prosperity-timestamp": timestamp,
        "x-prosperity-signature": sign(body, timestamp, runtime.secret),
      },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha de rede.";
    await deliveryTable(input.admin).update({
      status: "failed",
      attempts: delivery.attempts + 1,
      last_error: message.slice(0, 1000),
      last_attempt_at: new Date().toISOString(),
    }).eq("id", delivery.id);
    throw error;
  }

  const responseText = (await response.text()).slice(0, 2000);
  const { error: updateError } = await deliveryTable(input.admin).update({
    status: response.ok ? "delivered" : "failed",
    attempts: delivery.attempts + 1,
    response_status: response.status,
    response_body: responseText || null,
    last_error: response.ok ? null : `HTTP ${response.status}`,
    last_attempt_at: new Date().toISOString(),
    delivered_at: response.ok ? new Date().toISOString() : null,
  }).eq("id", delivery.id);
  if (updateError) throw updateError;
  if (!response.ok) throw new Error(`Integração ${input.integrationKey} recusou o webhook com HTTP ${response.status}.`);

  return { sent: true, eventId: delivery.event_id };
}
