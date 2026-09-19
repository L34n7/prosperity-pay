import { createAdminClient } from "@/lib/supabase/admin";
import { deliverIntegrationWebhook } from "@/lib/integrations/outbound-webhook";
import type { Json } from "@/lib/supabase/database.types";

type AdminClient = ReturnType<typeof createAdminClient>;

type SupportedPaymentStatus =
  | "approved"
  | "rejected"
  | "cancelled"
  | "refunded"
  | "charged_back";

type RoutedIntegration = {
  integration: string;
};

function eventTypeFor(status: SupportedPaymentStatus) {
  if (status === "approved") return "payment.approved" as const;
  if (status === "refunded") return "payment.refunded" as const;
  if (status === "charged_back") return "payment.chargeback" as const;
  return "payment.failed" as const;
}

function isSupportedStatus(status: string): status is SupportedPaymentStatus {
  return [
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
      "id,order_id,external_payment_id,status,gross_amount_cents,currency,paid_at,refunded_at"
    )
    .eq("id", paymentId)
    .single();

  if (paymentError || !payment) {
    throw paymentError ?? new Error("Pagamento não encontrado para integração.");
  }

  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("id,offer_id,customer_id,product_id")
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
  const results: Array<{
    integration: string;
    sent: boolean;
    error?: string;
  }> = [];

  for (const integrationKey of integrations) {
    const payload = {
      version: "2026-09-18",
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
      },
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
