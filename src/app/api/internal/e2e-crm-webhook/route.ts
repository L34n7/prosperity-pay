import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import {
  getCrmProsperityRuntimeConfig,
  signCrmProsperityPayload,
} from "@/lib/integrations/crm-prosperity-config";
import { createAdminClient } from "@/lib/supabase/admin";

const TEST_TOKEN = "1f14cc2441f666b60659a140ff4151ae72a7e1428f829dda26ebee9c3249c38b";
const EXPIRES_AT = Date.parse("2026-09-16T08:10:00.000Z");
const EVENT_ID = "093528af-1d5e-472f-9546-96363729965a";
const PAYMENT_ID = "d22e5a65-2359-411d-b937-df8d9ae582f9";
const EXTERNAL_PAYMENT_ID = "e2e-d22e5a65-2359-411d-b937-df8d9ae582f9";
const TEST_EMAIL = "prosperity-pay-e2e-20260916072331@example.com";

function tokenValido(recebido: string | null) {
  if (!recebido) return false;
  const esperado = Buffer.from(TEST_TOKEN);
  const atual = Buffer.from(recebido);
  return esperado.length === atual.length && timingSafeEqual(esperado, atual);
}

export async function GET(request: Request) {
  if (Date.now() > EXPIRES_AT) {
    return NextResponse.json({ ok: false, error: "Teste expirado." }, { status: 410 });
  }

  const url = new URL(request.url);
  if (!tokenValido(url.searchParams.get("token"))) {
    return NextResponse.json({ ok: false, error: "Não autorizado." }, { status: 401 });
  }

  const admin = createAdminClient();
  const integration = await getCrmProsperityRuntimeConfig(admin);

  if (!integration.configured || !integration.active || !integration.webhookUrl || !integration.secret) {
    return NextResponse.json(
      { ok: false, error: "Integração CRM Prosperity não está ativa/configurada." },
      { status: 409 }
    );
  }

  const occurredAt = new Date().toISOString();
  const payload = {
    event_id: EVENT_ID,
    version: "2026-09-16",
    event: "payment.approved",
    occurred_at: occurredAt,
    payment: {
      id: PAYMENT_ID,
      external_id: EXTERNAL_PAYMENT_ID,
      status: "approved",
      amount_cents: 500,
      currency: "BRL",
      paid_at: occurredAt,
      refunded_at: null,
    },
    order: {
      id: "7c0afcd3-d204-437d-aefb-147cefbfcdd2",
    },
    offer: {
      id: "b8ad5863-0412-4598-a3cc-246aa9bbfecb",
      reference: "248a0b141abf",
      name: "Prosperity Pay Teste R$ 5 - Plano Básico",
      billing_type: "recurring",
    },
    product: {
      id: "083cdf97-b7cb-40dc-9d56-66367bfd375d",
      name: "CRM Prosperity - Teste E2E",
    },
    customer: {
      id: "cd855571-03c9-44da-b020-568747a7b42e",
      name: "Teste E2E Prosperity Pay",
      email: TEST_EMAIL,
    },
  };

  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const response = await fetch(integration.webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-prosperity-event-id": EVENT_ID,
      "x-prosperity-timestamp": timestamp,
      "x-prosperity-signature": signCrmProsperityPayload(body, timestamp, integration.secret),
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });

  const responseText = (await response.text()).slice(0, 4000);

  return NextResponse.json(
    {
      ok: response.ok,
      crm_http_status: response.status,
      crm_response: responseText,
      event_id: EVENT_ID,
      payment_id: PAYMENT_ID,
      external_payment_id: EXTERNAL_PAYMENT_ID,
      customer_email: TEST_EMAIL,
      offer_reference: "248a0b141abf",
      amount_cents: 500,
      source: integration.source,
    },
    { status: response.ok ? 200 : 502 }
  );
}
