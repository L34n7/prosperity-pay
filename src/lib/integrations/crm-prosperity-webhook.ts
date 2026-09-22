import { getCrmProsperityRuntimeConfig, signCrmProsperityPayload } from "@/lib/integrations/crm-prosperity-config";
import { createAdminClient } from "@/lib/supabase/admin";
import { mercadoPagoPaymentMetadata } from "@/lib/payments/mercado-pago-payment-metadata";
import type { Json } from "@/lib/supabase/database.types";

type AdminClient = ReturnType<typeof createAdminClient>;
type SupportedPaymentStatus = "pending" | "approved" | "rejected" | "cancelled" | "refunded" | "charged_back";

type DeliveryRecord = {
  id: string;
  event_id: string;
  status: "pending" | "delivered" | "failed";
  attempts: number;
};

function eventTypeFor(status: SupportedPaymentStatus) {
  if (status === "pending") return "payment.pending" as const;
  if (status === "approved") return "payment.approved" as const;
  if (status === "refunded") return "payment.refunded" as const;
  if (status === "charged_back") return "payment.chargeback" as const;
  return "payment.failed" as const;
}

async function hydratePayment(admin: AdminClient, paymentId: string) {
  const { data: payment, error: paymentError } = await admin
    .from("payments")
    .select("id,order_id,external_payment_id,status,gross_amount_cents,currency,paid_at,refunded_at,raw_provider_data")
    .eq("id", paymentId)
    .single();
  if (paymentError || !payment) throw paymentError ?? new Error("Pagamento não encontrado para integração com o CRM.");

  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("id,offer_id,customer_id,product_id")
    .eq("id", payment.order_id)
    .single();
  if (orderError || !order) throw orderError ?? new Error("Pedido não encontrado para integração com o CRM.");

  const [offerResult, customerResult, productResult] = await Promise.all([
    admin.from("offers").select("id,name,checkout_slug,billing_type").eq("id", order.offer_id).single(),
    admin.from("customers").select("id,name,email").eq("id", order.customer_id).single(),
    admin.from("products").select("id,name").eq("id", order.product_id).single(),
  ]);

  if (offerResult.error || !offerResult.data) throw offerResult.error ?? new Error("Oferta não encontrada para integração com o CRM.");
  if (customerResult.error || !customerResult.data) throw customerResult.error ?? new Error("Cliente não encontrado para integração com o CRM.");
  if (productResult.error || !productResult.data) throw productResult.error ?? new Error("Produto não encontrado para integração com o CRM.");

  return {
    payment,
    order,
    offer: offerResult.data,
    customer: customerResult.data,
    product: productResult.data,
  };
}

function pixDataFromRaw(raw: unknown) {
  const root = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : null;
  const transactions = root?.transactions && typeof root.transactions === "object" && !Array.isArray(root.transactions)
    ? root.transactions as Record<string, unknown>
    : null;
  const payments = Array.isArray(transactions?.payments) ? transactions?.payments : [];
  const first = payments[0] && typeof payments[0] === "object" && !Array.isArray(payments[0])
    ? payments[0] as Record<string, unknown>
    : null;
  const method = first?.payment_method && typeof first.payment_method === "object" && !Array.isArray(first.payment_method)
    ? first.payment_method as Record<string, unknown>
    : null;
  const code = typeof method?.qr_code === "string" && method.qr_code.trim() ? method.qr_code.trim() : null;
  const ticketUrl = typeof method?.ticket_url === "string" && method.ticket_url.trim() ? method.ticket_url.trim() : null;
  return { code, ticketUrl };
}

async function isOfferRoutedToCrm(admin: AdminClient, offerReference: string) {
  const { data, error } = await admin
    .from("integration_webhook_routes")
    .select("id")
    .eq("integration", "crm_prosperity")
    .eq("offer_reference", offerReference)
    .eq("active", true)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function getOrCreateDelivery(input: {
  admin: AdminClient;
  paymentId: string;
  eventType: string;
  payload: Json;
}) {
  const { admin, paymentId, eventType, payload } = input;
  const inserted = await (admin as any)
    .from("integration_webhook_deliveries")
    .insert({
      integration: "crm_prosperity",
      payment_id: paymentId,
      subject_type: "payment",
      subject_id: paymentId,
      event_type: eventType,
      payload,
      status: "pending",
    })
    .select("id,event_id,status,attempts")
    .single();

  if (!inserted.error && inserted.data) return inserted.data as DeliveryRecord;
  if (inserted.error?.code !== "23505") throw inserted.error;

  const existing = await (admin as any)
    .from("integration_webhook_deliveries")
    .select("id,event_id,status,attempts")
    .eq("integration", "crm_prosperity")
    .eq("payment_id", paymentId)
    .eq("event_type", eventType)
    .single();
  if (existing.error || !existing.data) throw existing.error ?? new Error("Entrega de webhook não encontrada.");
  return existing.data as DeliveryRecord;
}

export async function deliverCrmProsperityPaymentWebhook(input: {
  admin: AdminClient;
  paymentId: string;
  paymentStatus: string;
}) {
  const status = input.paymentStatus as SupportedPaymentStatus;
  if (!["pending", "approved", "rejected", "cancelled", "refunded", "charged_back"].includes(status)) {
    return { sent: false, reason: "status_not_supported" as const };
  }

  const integration = await getCrmProsperityRuntimeConfig(input.admin);
  if (!integration.configured) {
    console.warn("[CRM PROSPERITY WEBHOOK] Integração não configurada; evento não enviado.");
    return { sent: false, reason: "integration_not_configured" as const };
  }
  if (!integration.active) {
    return { sent: false, reason: integration.status === "pending" ? "integration_pending" as const : "integration_disconnected" as const };
  }
  if (!integration.webhookUrl || !integration.secret) {
    throw new Error("Integração com o CRM Prosperity está ativa, mas incompleta.");
  }

  const hydrated = await hydratePayment(input.admin, input.paymentId);
  if (!(await isOfferRoutedToCrm(input.admin, hydrated.offer.checkout_slug))) {
    return { sent: false, reason: "offer_not_routed" as const };
  }

  const eventType = eventTypeFor(status);
  const occurredAt = new Date().toISOString();
  const providerMetadata = mercadoPagoPaymentMetadata(hydrated.payment.raw_provider_data);
  const method = providerMetadata.method === "pix"
    ? "pix"
    : providerMetadata.method === "card"
      ? "card"
      : null;
  const pix = pixDataFromRaw(hydrated.payment.raw_provider_data);

  const basePayload = {
    version: "2026-09-22",
    event: eventType,
    occurred_at: occurredAt,
    payment: {
      id: hydrated.payment.id,
      external_id: hydrated.payment.external_payment_id,
      status: hydrated.payment.status,
      amount_cents: Number(hydrated.payment.gross_amount_cents),
      currency: hydrated.payment.currency,
      paid_at: hydrated.payment.paid_at,
      refunded_at: hydrated.payment.refunded_at,
      method,
      pix_code: pix.code,
      pix_ticket_url: pix.ticketUrl,
    },
    ...(pix.code ? {
      transaction: {
        pix: {
          code: pix.code,
          ticket_url: pix.ticketUrl,
        },
      },
    } : {}),
    order: {
      id: hydrated.order.id,
    },
    offer: {
      id: hydrated.offer.id,
      reference: hydrated.offer.checkout_slug,
      name: hydrated.offer.name,
      billing_type: hydrated.offer.billing_type,
    },
    product: {
      id: hydrated.product.id,
      name: hydrated.product.name,
    },
    customer: {
      id: hydrated.customer.id,
      name: hydrated.customer.name,
      email: hydrated.customer.email,
    },
  } satisfies Json;

  const delivery = await getOrCreateDelivery({
    admin: input.admin,
    paymentId: hydrated.payment.id,
    eventType,
    payload: basePayload,
  });

  if (delivery.status === "delivered") {
    return { sent: false, reason: "already_delivered" as const, eventId: delivery.event_id };
  }

  const body = JSON.stringify({
    event_id: delivery.event_id,
    ...basePayload,
  });
  const timestamp = String(Math.floor(Date.now() / 1000));

  let response: Response;
  try {
    response = await fetch(integration.webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-prosperity-event-id": delivery.event_id,
        "x-prosperity-timestamp": timestamp,
        "x-prosperity-signature": signCrmProsperityPayload(body, timestamp, integration.secret),
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha de rede ao enviar webhook.";
    await (input.admin as any).from("integration_webhook_deliveries").update({
      status: "failed",
      attempts: delivery.attempts + 1,
      last_error: message.slice(0, 1000),
      last_attempt_at: new Date().toISOString(),
    }).eq("id", delivery.id);
    throw new Error(`Falha ao entregar webhook ao CRM Prosperity: ${message}`);
  }

  const responseText = (await response.text()).slice(0, 2000);
  const update = await (input.admin as any).from("integration_webhook_deliveries").update({
    status: response.ok ? "delivered" : "failed",
    attempts: delivery.attempts + 1,
    response_status: response.status,
    response_body: responseText || null,
    last_error: response.ok ? null : `HTTP ${response.status}`,
    last_attempt_at: new Date().toISOString(),
    delivered_at: response.ok ? new Date().toISOString() : null,
  }).eq("id", delivery.id);
  if (update.error) throw update.error;

  if (!response.ok) {
    throw new Error(`CRM Prosperity recusou o webhook com HTTP ${response.status}.`);
  }

  return { sent: true, eventId: delivery.event_id };
}
