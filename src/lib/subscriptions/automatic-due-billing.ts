import { sendSubscriptionBillingEmail } from "@/lib/email/resend-auth";
import {
  createSubscriptionSessionCheckout,
  getSubscriptionCheckoutSessionView,
} from "@/lib/checkout/subscription-session-checkout";
import { createPrepaidSubscriptionIntent } from "@/lib/subscriptions/prepaid-billing";
import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

type DueSubscription = {
  id: string;
  product_id: string;
  customer_id: string;
  current_period_end: string;
  status: string;
};

function sessionTokenFromUrl(value: string) {
  try {
    const url = new URL(value);
    const parts = url.pathname.split("/").filter(Boolean);
    const token = parts.at(-1) || "";
    if (!token) throw new Error();
    return token;
  } catch {
    throw new Error("URL de checkout da renovação inválida.");
  }
}

async function claimBillingDelivery(
  admin: AdminClient,
  input: {
    subscriptionId: string;
    productId: string;
    customerId: string;
    dueAt: string;
  },
) {
  const table = (admin as any).from("subscription_billing_deliveries");
  const inserted = await table
    .insert({
      subscription_id: input.subscriptionId,
      product_id: input.productId,
      customer_id: input.customerId,
      due_at: input.dueAt,
      status: "processing",
      attempts: 1,
    })
    .select("id,status,attempts,updated_at")
    .single();

  if (!inserted.error && inserted.data) return inserted.data;
  if (inserted.error?.code !== "23505") throw inserted.error;

  const existingResult = await table
    .select("id,status,attempts,updated_at")
    .eq("subscription_id", input.subscriptionId)
    .eq("due_at", input.dueAt)
    .single();

  if (existingResult.error || !existingResult.data) {
    throw existingResult.error ?? new Error("Controle de cobrança não encontrado.");
  }

  const existing = existingResult.data;
  if (existing.status === "sent" || existing.status === "skipped") return null;

  const processingRecently =
    existing.status === "processing" &&
    Date.now() - new Date(existing.updated_at).getTime() < 30 * 60 * 1000;

  if (processingRecently) return null;

  const retry = await table
    .update({
      status: "processing",
      attempts: Number(existing.attempts || 0) + 1,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.id)
    .select("id,status,attempts,updated_at")
    .single();

  if (retry.error || !retry.data) {
    throw retry.error ?? new Error("Não foi possível retomar a cobrança.");
  }

  return retry.data;
}

async function finishDelivery(
  admin: AdminClient,
  deliveryId: string,
  values: Record<string, unknown>,
) {
  const { error } = await (admin as any)
    .from("subscription_billing_deliveries")
    .update({
      ...values,
      updated_at: new Date().toISOString(),
    })
    .eq("id", deliveryId);

  if (error) throw error;
}

async function processOne(
  admin: AdminClient,
  subscription: DueSubscription,
  product: {
    id: string;
    name: string;
    status: string;
    automatic_due_billing_enabled: boolean;
  },
) {
  if (!product.automatic_due_billing_enabled || product.status !== "active") {
    return { status: "disabled" as const };
  }

  const delivery = await claimBillingDelivery(admin, {
    subscriptionId: subscription.id,
    productId: subscription.product_id,
    customerId: subscription.customer_id,
    dueAt: subscription.current_period_end,
  });

  if (!delivery) {
    return { status: "duplicate" as const };
  }

  try {
    const { data: customer, error: customerError } = await admin
      .from("customers")
      .select("id,name,email")
      .eq("id", subscription.customer_id)
      .single();

    if (customerError || !customer?.email) {
      throw customerError ?? new Error("Cliente sem e-mail para cobrança.");
    }

    const intent = await createPrepaidSubscriptionIntent({
      subscriptionId: subscription.id,
      action: { type: "renew" },
    });

    if (intent.status !== "awaiting_payment" || !intent.checkoutUrl) {
      throw new Error("A renovação não gerou um checkout disponível.");
    }

    const token = sessionTokenFromUrl(intent.checkoutUrl);
    const view = await getSubscriptionCheckoutSessionView(token);

    const pixResult = await createSubscriptionSessionCheckout({
      sessionToken: token,
      customerName: customer.name || undefined,
      customerEmail: customer.email,
      idempotencyKey: `automatic-due:${subscription.id}:${subscription.current_period_end}`,
      paymentMethod: "pix",
    });

    if (!pixResult.orderId) {
      throw new Error("Cobrança automática sem pedido interno.");
    }

    const pixCode =
      "qrCode" in pixResult ? pixResult.qrCode : undefined;
    const pixTicketUrl =
      "ticketUrl" in pixResult ? pixResult.ticketUrl : undefined;

    if (!pixCode) {
      throw new Error("Mercado Pago não retornou o PIX Copia e Cola.");
    }

    const { data: payment, error: paymentError } = await admin
      .from("payments")
      .select("id")
      .eq("order_id", pixResult.orderId)
      .order("created_at", { ascending: true })
      .limit(1)
      .single();

    if (paymentError || !payment) {
      throw paymentError ?? new Error("Pagamento da cobrança não encontrado.");
    }

    await sendSubscriptionBillingEmail({
      to: customer.email,
      name: customer.name || customer.email.split("@")[0] || "cliente",
      productName: product.name,
      dueAt: subscription.current_period_end,
      lines: view.lines.map((line) => ({
        description: line.description,
        quantity: Number(line.quantity || 1),
        totalAmountCents: Number(line.totalAmountCents || 0),
      })),
      totalAmountCents: Number(view.amountCents),
      pixCode,
      checkoutUrl: intent.checkoutUrl,
    });

    await finishDelivery(admin, delivery.id, {
      status: "sent",
      order_id: pixResult.orderId,
      payment_id: payment.id,
      checkout_url: intent.checkoutUrl,
      pix_code: pixCode,
      pix_ticket_url: pixTicketUrl || null,
      recipient_email: customer.email,
      sent_at: new Date().toISOString(),
      last_error: null,
    });

    return {
      status: "sent" as const,
      subscriptionId: subscription.id,
      orderId: pixResult.orderId,
      amountCents: Number(view.amountCents),
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000);

    await finishDelivery(admin, delivery.id, {
      status: "failed",
      last_error: message,
    }).catch(() => undefined);

    console.error("[AUTOMATIC DUE BILLING] Falha ao gerar cobrança.", {
      subscriptionId: subscription.id,
      dueAt: subscription.current_period_end,
      error: message,
    });

    return {
      status: "failed" as const,
      subscriptionId: subscription.id,
      error: message,
    };
  }
}

export async function processAutomaticDueBilling(limit = 100) {
  const admin = createAdminClient();
  const now = new Date();
  const lowerBound = new Date(now.getTime() - 36 * 60 * 60 * 1000);

  const { data: subscriptions, error: subscriptionsError } = await admin
    .from("subscriptions")
    .select("id,product_id,customer_id,current_period_end,status")
    .eq("billing_model", "prepaid")
    .in("status", ["active", "past_due"])
    .not("current_period_end", "is", null)
    .lte("current_period_end", now.toISOString())
    .gte("current_period_end", lowerBound.toISOString())
    .order("current_period_end", { ascending: true })
    .limit(Math.max(1, Math.min(500, limit)));

  if (subscriptionsError) throw subscriptionsError;

  const rows = (subscriptions ?? []) as DueSubscription[];
  if (!rows.length) {
    return { processed: 0, sent: 0, failed: 0, results: [] };
  }

  const productIds = [...new Set(rows.map((item) => item.product_id))];
  const { data: products, error: productsError } = await (admin as any)
    .from("products")
    .select("id,name,status,automatic_due_billing_enabled")
    .in("id", productIds);

  if (productsError) throw productsError;

  const byProduct = new Map(
    (products ?? []).map((product: any) => [product.id, product]),
  );

  const results = [];
  for (const subscription of rows) {
    const product = byProduct.get(subscription.product_id);
    if (!product?.automatic_due_billing_enabled) continue;
    results.push(await processOne(admin, subscription, product));
  }

  return {
    processed: results.length,
    sent: results.filter((item) => item.status === "sent").length,
    failed: results.filter((item) => item.status === "failed").length,
    results,
  };
}
