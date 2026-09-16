import { NextResponse } from "next/server";
import { fetchMercadoPagoOrder, syncTransparentOrder } from "@/lib/checkout/transparent-checkout-service";
import { env, requireEnv } from "@/lib/env";
import { deliverCrmProsperityWebhookForOrder } from "@/lib/integrations/crm-prosperity-order-delivery";
import { verifyMercadoPagoSignature } from "@/lib/payments/providers/mercadopago/webhook-signature";
import { sha256 } from "@/lib/security/hash";
import { createAdminClient } from "@/lib/supabase/admin";

type OrderWebhookPayload = {
  id?: string | number;
  type?: string;
  action?: string;
  data?: { id?: string | number };
};

export async function POST(request: Request) {
  const rawBody = await request.text();
  let payload: OrderWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as OrderWebhookPayload;
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const url = new URL(request.url);
  const dataId = String(payload.data?.id ?? url.searchParams.get("data.id") ?? "");
  if (!dataId) return NextResponse.json({ received: true, ignored: true });

  const signature = request.headers.get("x-signature") ?? "";
  const requestId = request.headers.get("x-request-id") ?? "";
  const secret = requireEnv(env.mercadoPagoWebhookSecret, "MERCADO_PAGO_WEBHOOK_SECRET");
  if (!verifyMercadoPagoSignature({ signature, requestId, dataId, secret })) {
    return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: provider } = await admin.from("payment_providers")
    .select("id")
    .eq("code", "mercadopago")
    .single();
  if (!provider) return NextResponse.json({ error: "Provedor indisponível." }, { status: 503 });

  const { data: checkout, error: checkoutError } = await admin.from("payment_provider_checkouts")
    .select("order_id,connection_id")
    .eq("provider_id", provider.id)
    .eq("external_checkout_id", dataId)
    .maybeSingle();
  if (checkoutError) return NextResponse.json({ error: "Falha ao localizar checkout." }, { status: 503 });
  if (!checkout) {
    // A notificação pode chegar alguns milissegundos antes de persistirmos o ID da Order.
    // Retornar 503 faz o Mercado Pago reenviar a notificação sem perder o evento.
    return NextResponse.json({ error: "Order ainda não vinculada." }, { status: 503 });
  }

  const externalEventId = payload.id ? String(payload.id) : requestId || `${payload.action ?? "order.updated"}:${dataId}`;
  const payloadHash = sha256(rawBody);
  let { data: event, error: eventError } = await admin.from("webhook_events").insert({
    provider_id: provider.id,
    external_event_id: externalEventId,
    external_resource_id: dataId,
    event_type: payload.action ?? payload.type ?? "order.updated",
    payload_hash: payloadHash,
    payload: payload as never,
    status: "processing",
    attempts: 1,
  }).select("id").single();

  if (eventError?.code === "23505") {
    const { data: existing } = await admin.from("webhook_events")
      .select("id,status,attempts")
      .eq("provider_id", provider.id)
      .eq("external_event_id", externalEventId)
      .maybeSingle();
    if (!existing) return NextResponse.json({ received: true, duplicate: true });
    if (existing.status === "processed" || existing.status === "ignored") {
      return NextResponse.json({ received: true, duplicate: true });
    }
    const retry = await admin.from("webhook_events").update({
      status: "processing",
      attempts: Number(existing.attempts) + 1,
      error_message: null,
    }).eq("id", existing.id).select("id").single();
    if (retry.error || !retry.data) return NextResponse.json({ error: "Evento em processamento." }, { status: 503 });
    event = retry.data as typeof event;
    eventError = null;
  }

  if (eventError || !event) return NextResponse.json({ error: "Falha ao registrar evento." }, { status: 500 });

  try {
    const mpOrder = await fetchMercadoPagoOrder(checkout.connection_id, dataId);
    await syncTransparentOrder({
      admin,
      internalOrderId: checkout.order_id,
      mpOrder,
      eventId: event.id,
    });
    await deliverCrmProsperityWebhookForOrder(admin, checkout.order_id);
    await admin.from("webhook_events").update({
      status: "processed",
      processed_at: new Date().toISOString(),
    }).eq("id", event.id);
    return NextResponse.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : "Erro desconhecido";
    await admin.from("webhook_events").update({ status: "failed", error_message: message }).eq("id", event.id);
    console.error(error);
    return NextResponse.json({ error: "Falha ao processar Order." }, { status: 500 });
  }
}
