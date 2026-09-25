import { createAdminClient } from "@/lib/supabase/admin";
import { deliverIntegrationWebhook } from "@/lib/integrations/outbound-webhook";
import { mercadoPagoPaymentMetadata } from "@/lib/payments/mercado-pago-payment-metadata";
import type { Json } from "@/lib/supabase/database.types";

type AdminClient = ReturnType<typeof createAdminClient>;

type SupportedPaymentStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "refunded"
  | "charged_back";

type RoutedIntegration = {
  integration: string;
};

function eventTypeFor(status: SupportedPaymentStatus) {
  if (status === "pending") return "payment.pending" as const;
  if (status === "approved") return "payment.approved" as const;
  if (status === "refunded") return "payment.refunded" as const;
  if (status === "charged_back") return "payment.chargeback" as const;
  return "payment.failed" as const;
}

function isSupportedStatus(status: string): status is SupportedPaymentStatus {
  return [
    "pending",
    "approved",
    "rejected",
    "cancelled",
    "refunded",
    "charged_back",
  ].includes(status);
}

async function hydratePayment(admin: AdminClient, paymentId: string) {
  const { data: payment, error: paymentError } = await admin
    .from("payments")
    .select(
      "id,order_id,external_payment_id,status,gross_amount_cents,currency,paid_at,refunded_at,raw_provider_data"
    )
    .eq("id", paymentId)
    .single();

  if (paymentError || !payment) {
    throw paymentError ?? new Error("Pagamento não encontrado para integração.");
  }

  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("id,offer_id,customer_id,product_id,billing_reason,subscription_id,subscription_change_id,idempotency_key")
    .eq("id", payment.order_id)
    .single();

  if (orderError || !order) {
    throw orderError ?? new Error("Pedido não encontrado para integração.");
  }

  const [offerResult, customerResult, productResult] = await Promise.all([
    admin
      .from("offers")
      .select("id,name,checkout_slug,billing_type")
      .eq("id", order.offer_id)
      .single(),
    admin
      .from("customers")
      .select("id,name,email")
      .eq("id", order.customer_id)
      .single(),
    admin
      .from("products")
      .select("id,name")
      .eq("id", order.product_id)
      .single(),
  ]);

  if (offerResult.error || !offerResult.data) {
    throw offerResult.error ?? new Error("Oferta não encontrada para integração.");
  }
  if (customerResult.error || !customerResult.data) {
    throw customerResult.error ?? new Error("Cliente não encontrado para integração.");
  }
  if (productResult.error || !productResult.data) {
    throw productResult.error ?? new Error("Produto não encontrado para integração.");
  }

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

async function routedIntegrations(admin: AdminClient, offerReference: string) {
  const { data, error } = await (admin as any)
    .from("integration_webhook_routes")
    .select("integration")
    .eq("offer_reference", offerReference)
    .eq("active", true);

  if (error) throw error;

  const unique = new Set<string>();
  for (const route of (data ?? []) as RoutedIntegration[]) {
    const key = String(route.integration || "").trim();
    if (key) unique.add(key);
  }

  return [...unique];
}

export async function dispatchPaymentIntegrationEvents(
  admin: AdminClient,
  paymentId: string
) {
  const hydrated = await hydratePayment(admin, paymentId);
  const status = String(hydrated.payment.status);

  if (!isSupportedStatus(status)) {
    return {
      sent: 0,
      integrations: [] as string[],
      reason: "status_not_supported" as const,
    };
  }

  const integrations = await routedIntegrations(
    admin,
    hydrated.offer.checkout_slug
  );

  if (!integrations.length) {
    return {
      sent: 0,
      integrations: [] as string[],
      reason: "offer_not_routed" as const,
    };
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
  const generationSource =
    String(hydrated.order.idempotency_key || "").startsWith("automatic-due:")
      ? "platform_automatic"
      : "customer";
  const results: Array<{
    integration: string;
    sent: boolean;
    error?: string;
  }> = [];

  for (const integrationKey of integrations) {
    const payload = {
      version: "2026-09-22",
      event: eventType,
      occurred_at: occurredAt,
      integration: {
        key: integrationKey,
      },
      payment: {
        id: hydrated.payment.id,
        external_id: hydrated.payment.external_payment_id,
        status: hydrated.payment.status,
        amount_cents: Number(hydrated.payment.gross_amount_cents),
        currency: hydrated.payment.currency,
        paid_at: hydrated.payment.paid_at,
        refunded_at: hydrated.payment.refunded_at,
        method,
        generation_source: generationSource,
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
        billing_reason: hydrated.order.billing_reason,
        subscription_id: hydrated.order.subscription_id,
        subscription_change_id: hydrated.order.subscription_change_id,
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

    try {
      const result = await deliverIntegrationWebhook({
        admin,
        integrationKey,
        subjectType: "payment",
        subjectId: hydrated.payment.id,
        eventType,
        payload,
      });

      results.push({
        integration: integrationKey,
        sent: result.sent === true,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);

      console.error("[PAYMENT INTEGRATION WEBHOOK] Falha na entrega", {
        integrationKey,
        paymentId: hydrated.payment.id,
        eventType,
        error: message,
      });

      results.push({
        integration: integrationKey,
        sent: false,
        error: message,
      });
    }
  }

  return {
    sent: results.filter((item) => item.sent).length,
    integrations,
    results,
  };
}

export async function dispatchPaymentIntegrationEventsSafe(
  admin: AdminClient,
  paymentId: string
) {
  try {
    return await dispatchPaymentIntegrationEvents(admin, paymentId);
  } catch (error) {
    console.error("[PAYMENT INTEGRATION WEBHOOK] Falha ao preparar evento", {
      paymentId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      sent: 0,
      integrations: [] as string[],
      error: true as const,
    };
  }
}
