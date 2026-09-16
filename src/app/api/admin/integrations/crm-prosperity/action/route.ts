import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { asObject, HttpError, jsonError, requiredString } from "@/lib/api/http";
import { requirePlatformAdmin } from "@/lib/auth/require-user";
import {
  CRM_PROSPERITY_INTEGRATION_KEY,
  encryptCrmProsperitySecret,
  generateCrmProsperitySecret,
  getManagedCrmProsperityIntegration,
  signCrmProsperityPayload,
} from "@/lib/integrations/crm-prosperity-config";
import { decryptSecret } from "@/lib/security/secrets";
import { createAdminClient } from "@/lib/supabase/admin";

function integrationTable() {
  return (createAdminClient() as any).from("platform_integrations");
}

async function requireIntegration() {
  const admin = createAdminClient();
  const integration = await getManagedCrmProsperityIntegration(admin);
  if (!integration) throw new HttpError(404, "Integração com o CRM Prosperity não encontrada.");
  return integration;
}

async function updateIntegration(values: Record<string, unknown>) {
  const { data, error } = await integrationTable()
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("integration_key", CRM_PROSPERITY_INTEGRATION_KEY)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function POST(request: Request) {
  try {
    const { user } = await requirePlatformAdmin();
    const body = asObject(await request.json());
    const action = requiredString(body, "action", 40);
    const integration = await requireIntegration();

    if (action === "disconnect") {
      await updateIntegration({
        status: "disconnected",
        disconnected_at: new Date().toISOString(),
        last_updated_by: user.id,
      });
      return NextResponse.json({ ok: true, status: "disconnected" });
    }

    if (action === "reconnect") {
      await updateIntegration({
        status: "active",
        disconnected_at: null,
        last_updated_by: user.id,
      });
      return NextResponse.json({ ok: true, status: "active" });
    }

    if (action === "rotate_secret") {
      const secret = generateCrmProsperitySecret();
      await updateIntegration({
        secret_encrypted: encryptCrmProsperitySecret(secret),
        secret_last_four: secret.slice(-4),
        last_tested_at: null,
        last_test_status: null,
        last_test_http_status: null,
        last_test_message: null,
        last_updated_by: user.id,
      });
      return NextResponse.json({ ok: true, secret, secretLastFour: secret.slice(-4) });
    }

    if (action === "test") {
      if (integration.status !== "active") {
        throw new HttpError(409, "Reconecte a integração antes de testar.");
      }

      const eventId = randomUUID();
      const payload = {
        event_id: eventId,
        version: "2026-09-16",
        event: "integration.test",
        occurred_at: new Date().toISOString(),
        integration: {
          key: CRM_PROSPERITY_INTEGRATION_KEY,
          name: integration.name,
        },
        payment: {
          id: `integration-test-${eventId}`,
          external_id: `integration-test-${eventId}`,
          status: "test",
          amount_cents: 0,
          currency: "BRL",
        },
      };
      const rawBody = JSON.stringify(payload);
      const timestamp = String(Math.floor(Date.now() / 1000));
      const secret = decryptSecret(integration.secret_encrypted);

      let response: Response;
      let responseText = "";
      try {
        response = await fetch(integration.webhook_url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-prosperity-event-id": eventId,
            "x-prosperity-timestamp": timestamp,
            "x-prosperity-signature": signCrmProsperityPayload(rawBody, timestamp, secret),
          },
          body: rawBody,
          cache: "no-store",
          signal: AbortSignal.timeout(10_000),
        });
        responseText = (await response.text()).slice(0, 1000);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Falha de rede ao testar integração.";
        await updateIntegration({
          last_tested_at: new Date().toISOString(),
          last_test_status: "failed",
          last_test_http_status: null,
          last_test_message: message.slice(0, 1000),
          last_updated_by: user.id,
        });
        throw new HttpError(502, `Falha ao acessar o CRM Prosperity: ${message}`);
      }

      await updateIntegration({
        last_tested_at: new Date().toISOString(),
        last_test_status: response.ok ? "success" : "failed",
        last_test_http_status: response.status,
        last_test_message: response.ok ? "Conexão e assinatura validadas com sucesso." : (responseText || `HTTP ${response.status}`).slice(0, 1000),
        last_updated_by: user.id,
      });

      if (!response.ok) {
        throw new HttpError(502, `O CRM Prosperity recusou o teste com HTTP ${response.status}.`);
      }

      return NextResponse.json({
        ok: true,
        status: response.status,
        eventId,
        message: "Conexão e assinatura validadas com sucesso.",
      });
    }

    throw new HttpError(400, "Ação inválida para a integração.");
  } catch (error) {
    return jsonError(error);
  }
}
