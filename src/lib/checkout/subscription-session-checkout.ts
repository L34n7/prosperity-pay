import { HttpError } from "@/lib/api/http";
import { getProviderAccessToken } from "@/lib/payments/provider-credentials";
import { digits, sha256 } from "@/lib/security/hash";
import { createRecurringSnapshot } from "@/lib/subscriptions/recurring-financials";
import { createAdminClient } from "@/lib/supabase/admin";
import { syncTransparentOrder, type MercadoPagoOrder } from "@/lib/checkout/transparent-checkout-service";
import type { Json } from "@/lib/supabase/database.types";

type AdminClient = ReturnType<typeof createAdminClient>;
type PaymentMethod = "card" | "pix";

export type SubscriptionSessionCheckoutInput = {
  sessionToken: string;
  customerName?: string;
  customerEmail: string;
  customerDocument?: string;
  deviceId?: string;
  idempotencyKey: string;
  paymentMethod: PaymentMethod;
  card?: {
    token: string;
    paymentMethodId: string;
    installments: number;
    issuerId?: string;
  };
};

type StoredLine = {
  lineType: "base" | "addon" | "proration";
  itemCode: string;
  description: string;
  unitAmountCents: number;
  quantity: number;
  totalAmountCents: number;
  commissionableAmountCents: number;
  metadata?: Record<string, Json | undefined>;
};

type SessionMetadata = {
  lines: StoredLine[];
  affiliateBaseAmountCents: number;
  targetOfferId: string;
  billingReason: "subscription_change" | "subscription_renewal";
  renewalDueAt?: string;
};

function parseMetadata(value: Json): SessionMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(409, "Sessão de assinatura sem composição financeira.");
  }
  const raw = value as Record<string, Json | undefined>;
  const rawLines = Array.isArray(raw.lines) ? raw.lines : [];
  const lines: StoredLine[] = rawLines.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new HttpError(409, "Item financeiro inválido.");
    const row = entry as Record<string, Json | undefined>;
    return {
      lineType: String(row.lineType) as StoredLine["lineType"],
      itemCode: String(row.itemCode ?? ""),
      description: String(row.description ?? ""),
      unitAmountCents: Number(row.unitAmountCents ?? 0),
      quantity: Number(row.quantity ?? 0),
      totalAmountCents: Number(row.totalAmountCents ?? 0),
      commissionableAmountCents: Number(row.commissionableAmountCents ?? 0),
      metadata: row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? row.metadata as Record<string, Json | undefined>
        : undefined,
    };
  });
  const billingReason = String(raw.billingReason);
  if (!lines.length || !["subscription_change", "subscription_renewal"].includes(billingReason)) {
    throw new HttpError(409, "Sessão de assinatura incompleta.");
  }
  return {
    lines,
    affiliateBaseAmountCents: Number(raw.affiliateBaseAmountCents ?? 0),
    targetOfferId: String(raw.targetOfferId ?? ""),
    billingReason: billingReason as SessionMetadata["billingReason"],
    renewalDueAt:
      typeof raw.renewalDueAt === "string"
        ? raw.renewalDueAt
        : undefined,
  };
}

function money(cents: number) {
  return (cents / 100).toFixed(2);
}

function mappedResult(orderId: string, mpOrder: MercadoPagoOrder) {
  const transaction = mpOrder.transactions?.payments?.[0];
  const status = transaction?.status === "processed"
    ? "approved"
    : transaction?.status === "failed"
      ? "rejected"
      : transaction?.status === "canceled" || transaction?.status === "cancelled"
        ? "cancelled"
        : "pending";
  return {
    orderId,
    status,
    providerOrderId: mpOrder.id,
    qrCode: transaction?.payment_method?.qr_code,
    qrCodeBase64: transaction?.payment_method?.qr_code_base64,
    ticketUrl: transaction?.payment_method?.ticket_url,
  };
}

async function mpRequest<T>(token: string, path: string, init?: RequestInit, idempotencyKey?: string) {
  const response = await fetch(`https://api.mercadopago.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "X-Idempotency-Key": idempotencyKey } : {}),
      ...init?.headers,
    },
    cache: "no-store",
  });
  const body = await response.json() as T & { message?: string; error?: string };
  if (!response.ok) throw new HttpError(502, body.message || body.error || `Mercado Pago respondeu HTTP ${response.status}.`);
  return body;
}

async function centralConnection(admin: AdminClient) {
  const { data, error } = await admin.from("payment_provider_connections")
    .select("id,provider_id,payment_providers!inner(code)")
    .eq("connection_kind", "prosperity_balance")
    .is("owner_user_id", null)
    .eq("status", "active")
    .eq("payment_providers.code", "mercadopago")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) throw new HttpError(503, "Conta Mercado Pago central não configurada.");
  return data;
}

async function loadSession(admin: AdminClient, token: string) {
  const { data, error } = await admin.from("subscription_checkout_sessions")
    .select("id,subscription_id,subscription_change_id,session_type,amount_cents,currency,order_id,expires_at,consumed_at,metadata")
    .eq("token_hash", sha256(token))
    .single();
  if (error || !data) throw new HttpError(404, "Sessão de checkout não encontrada.");
  if (data.consumed_at) throw new HttpError(409, "Esta sessão já foi utilizada.");
  if (!data.order_id && new Date(data.expires_at).getTime() <= Date.now()) throw new HttpError(410, "Esta sessão expirou.");
  return { ...data, metadata: parseMetadata(data.metadata) };
}

async function existingResult(admin: AdminClient, orderId: string) {
  const { data: checkout, error: checkoutError } = await admin.from("payment_provider_checkouts")
    .select("connection_id,external_checkout_id")
    .eq("order_id", orderId)
    .maybeSingle();
  if (checkoutError) throw checkoutError;

  if (checkout?.external_checkout_id?.startsWith("ORD")) {
    const token = await getProviderAccessToken(checkout.connection_id);
    const mpOrder = await mpRequest<MercadoPagoOrder>(token, `/v1/orders/${encodeURIComponent(checkout.external_checkout_id)}`);
    return syncTransparentOrder({ admin, internalOrderId: orderId, mpOrder });
  }

  const { data: order } = await admin.from("orders").select("status").eq("id", orderId).single();
  return {
    orderId,
    status: order?.status === "paid" ? "approved" : "pending",
    providerOrderId: checkout?.external_checkout_id ?? undefined,
  };
}

export async function getSubscriptionCheckoutSessionView(sessionToken: string) {
  const admin = createAdminClient();
  const session = await loadSession(admin, sessionToken);
  const { data: subscription, error: subscriptionError } = await admin.from("subscriptions")
    .select("id,customer_id,product_id")
    .eq("id", session.subscription_id)
    .single();
  if (subscriptionError || !subscription) throw new HttpError(404, "Assinatura não encontrada.");

  const [productResult, customerResult, offerResult] = await Promise.all([
    admin.from("products").select("name,image_path").eq("id", subscription.product_id).single(),
    admin.from("customers").select("name,email").eq("id", subscription.customer_id).single(),
    admin.from("offers").select("id,name,checkout_slug").eq("id", session.metadata.targetOfferId).single(),
  ]);
  if (productResult.error || !productResult.data) throw new HttpError(404, "Produto não encontrado.");
  if (customerResult.error || !customerResult.data) throw new HttpError(404, "Cliente não encontrado.");
  if (offerResult.error || !offerResult.data) throw new HttpError(404, "Oferta da cobrança não encontrada.");

  return {
    amountCents: Number(session.amount_cents),
    currency: session.currency,
    expiresAt: session.expires_at,
    sessionType: session.session_type,
    product: productResult.data,
    customer: customerResult.data,
    offer: offerResult.data,
    lines: session.metadata.lines,
  };
}

export async function createSubscriptionSessionCheckout(input: SubscriptionSessionCheckoutInput) {
  const admin = createAdminClient();
  const session = await loadSession(admin, input.sessionToken);

  const { data: existingOrder, error: existingOrderError } = await admin
    .from("orders")
    .select("id")
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();

  if (existingOrderError) throw existingOrderError;
  if (existingOrder?.id) {
    return existingResult(admin, existingOrder.id);
  }

  if (
    session.session_type !== "subscription_renewal" &&
    session.order_id
  ) {
    return existingResult(admin, session.order_id);
  }

  const document = digits(input.customerDocument || "");
  if (
    input.paymentMethod === "card" &&
    document.length !== 11
  ) {
    throw new HttpError(400, "CPF inválido.");
  }
  if (document && document.length !== 11) {
    throw new HttpError(400, "CPF inválido.");
  }
  if (input.paymentMethod === "card" && (!input.card?.token || !input.card.paymentMethodId)) {
    throw new HttpError(400, "Dados tokenizados do cartão ausentes.");
  }
  if (input.paymentMethod === "card" && !input.deviceId) {
    throw new HttpError(400, "Device ID obrigatório para validar o cartão.");
  }
  if (input.paymentMethod === "card" && Number(input.card?.installments ?? 1) !== 1) {
    throw new HttpError(400, "Cobranças de assinatura devem ser pagas em 1x.");
  }

  const { data: subscription, error: subscriptionError } = await admin.from("subscriptions")
    .select("id,product_id,customer_id,offer_id,order_id,provider_id,cycle_number,currency,affiliate_membership_id,current_period_end")
    .eq("id", session.subscription_id)
    .single();
  if (subscriptionError || !subscription) throw new HttpError(404, "Assinatura não encontrada.");

  if (
    session.session_type === "subscription_renewal" &&
    session.metadata.renewalDueAt &&
    subscription.current_period_end
  ) {
    const dueAt = new Date(session.metadata.renewalDueAt).getTime();
    const currentPeriodEnd = new Date(subscription.current_period_end).getTime();

    if (
      Number.isFinite(dueAt) &&
      Number.isFinite(currentPeriodEnd) &&
      currentPeriodEnd > dueAt + 60_000
    ) {
      throw new HttpError(409, "Esta mensalidade já foi paga.");
    }
  }

  const [productResult, offerResult, customerResult] = await Promise.all([
    admin.from("products").select("id,name,producer_id,status,settlement_model,prosperity_fee_type,prosperity_fee_bps,prosperity_fee_fixed_cents").eq("id", subscription.product_id).single(),
    admin.from("offers").select("id,name,affiliate_enabled,affiliate_commission_type,affiliate_commission_bps,affiliate_commission_fixed_cents,affiliate_recurrence_mode,affiliate_recurrence_cycles,prosperity_fee_type,prosperity_fee_bps,prosperity_fee_fixed_cents").eq("id", session.metadata.targetOfferId).single(),
    admin.from("customers").select("id,email,name").eq("id", subscription.customer_id).single(),
  ]);
  if (productResult.error || !productResult.data) throw new HttpError(404, "Produto não encontrado.");
  if (offerResult.error || !offerResult.data) throw new HttpError(404, "Oferta da cobrança não encontrada.");
  if (customerResult.error || !customerResult.data) throw new HttpError(404, "Cliente não encontrado.");
  const product = productResult.data;
  const offer = offerResult.data;
  if (product.settlement_model !== "prosperity_balance") {
    throw new HttpError(409, "Alterações pré-pagas usam o Saldo Prosperity.");
  }

  await admin.from("customers").update({
    name: input.customerName?.trim() || customerResult.data.name,
    ...(document ? { document_hash: sha256(document) } : {}),
  }).eq("id", subscription.customer_id);

  const connection = await centralConnection(admin);
  const amountCents = Number(session.amount_cents);
  const { data: order, error: orderError } = await admin.from("orders").insert({
    product_id: subscription.product_id,
    offer_id: offer.id,
    producer_id: product.producer_id,
    customer_id: subscription.customer_id,
    settlement_model: product.settlement_model,
    gross_amount_cents: amountCents,
    currency: session.currency,
    idempotency_key: input.idempotencyKey,
    status: "draft",
    subscription_id: subscription.id,
    subscription_change_id: session.subscription_change_id,
    billing_reason: session.metadata.billingReason,
  }).select("id").single();
  if (orderError || !order) throw orderError ?? new Error("Falha ao criar pedido da assinatura.");

  if (session.session_type === "subscription_renewal") {
    const { error: attemptSessionError } = await admin
      .from("subscription_checkout_sessions")
      .insert({
        token_hash: sha256(
          `attempt:${session.id}:${order.id}:${crypto.randomUUID()}`,
        ),
        subscription_id: session.subscription_id,
        subscription_change_id: null,
        session_type: "subscription_renewal",
        amount_cents: session.amount_cents,
        currency: session.currency,
        order_id: order.id,
        expires_at: session.expires_at,
        metadata: session.metadata as unknown as Json,
      });

    if (attemptSessionError) {
      await admin.from("orders").delete().eq("id", order.id).eq("status", "draft");
      throw attemptSessionError;
    }
  } else {
    const { data: claimedOrderId, error: claimError } = await admin.rpc(
      "claim_subscription_checkout_session",
      {
        target_session_id: session.id,
        target_order_id: order.id,
      },
    );

    if (claimError) throw claimError;
    if (!claimedOrderId) {
      await admin.from("orders").delete().eq("id", order.id).eq("status", "draft");
      throw new HttpError(410, "Esta sessão expirou.");
    }
    if (claimedOrderId !== order.id) {
      await admin.from("orders").delete().eq("id", order.id).eq("status", "draft");
      return existingResult(admin, claimedOrderId);
    }
  }

  if (session.subscription_change_id) {
    const { error } = await admin.from("subscription_changes")
      .update({ payment_order_id: order.id })
      .eq("id", session.subscription_change_id);
    if (error) throw error;
  }

  const { error: itemsError } = await admin.from("order_items").insert(session.metadata.lines.map(line => ({
    order_id: order.id,
    subscription_id: subscription.id,
    line_type: line.lineType,
    item_code: line.itemCode,
    description: line.description,
    unit_amount_cents: line.unitAmountCents,
    quantity: line.quantity,
    total_amount_cents: line.totalAmountCents,
    commissionable_amount_cents: line.commissionableAmountCents,
    metadata: (line.metadata ?? {}) as Json,
  })));
  if (itemsError) throw itemsError;

  await createRecurringSnapshot({
    admin,
    orderId: order.id,
    originOrderId: subscription.order_id,
    affiliateMembershipId: subscription.affiliate_membership_id,
    grossAmountCents: amountCents,
    currency: session.currency,
    cycleNumber: session.session_type === "subscription_renewal"
      ? Number(subscription.cycle_number) + 1
      : Math.max(1, Number(subscription.cycle_number)),
    affiliateBaseAmountCents: Number(session.metadata.affiliateBaseAmountCents),
    affiliateCommissionLines: session.metadata.lines.map((line) => ({
      amountCents: Number(line.commissionableAmountCents),
      addonId:
        typeof line.metadata?.addonId === "string"
          ? line.metadata.addonId
          : null,
    })),
    product,
    offer,
  });

  const paymentId = crypto.randomUUID();
  const { data: paymentRow, error: paymentError } = await admin.from("payments").insert({
    id: paymentId,
    order_id: order.id,
    provider_id: connection.provider_id,
    connection_id: connection.id,
    external_reference: `prosperity:${paymentId}`,
    idempotency_key: `${input.idempotencyKey}:payment`,
    gross_amount_cents: amountCents,
    currency: session.currency,
    status: "pending",
  }).select("id").single();
  if (paymentError || !paymentRow) throw paymentError ?? new Error("Falha ao registrar pagamento.");

  const { error: checkoutError } = await admin.from("payment_provider_checkouts").insert({
    order_id: order.id,
    provider_id: connection.provider_id,
    connection_id: connection.id,
    idempotency_key: `${input.idempotencyKey}:subscription-session`,
  });
  if (checkoutError) throw checkoutError;

  const providerToken = await getProviderAccessToken(connection.id);
  const payer = {
    email: input.customerEmail.trim().toLowerCase(),
    ...(document
      ? { identification: { type: "CPF", number: document } }
      : {}),
  };
  const providerPayment = input.paymentMethod === "card" ? {
    amount: money(amountCents),
    payment_method: {
      id: input.card!.paymentMethodId,
      type: "credit_card",
      token: input.card!.token,
      installments: 1,
    },
  } : {
    amount: money(amountCents),
    payment_method: { id: "pix", type: "bank_transfer" },
    expiration_time: session.session_type === "subscription_change" ? "PT30M" : "P1D",
  };

  let mpOrder: MercadoPagoOrder;
  try {
    mpOrder = await mpRequest<MercadoPagoOrder>(providerToken, "/v1/orders", {
      method: "POST",
      headers: input.deviceId ? { "X-meli-session-id": input.deviceId } : undefined,
      body: JSON.stringify({
        type: "online",
        processing_mode: "automatic",
        total_amount: money(amountCents),
        external_reference: `prosperity-${order.id}`,
        description: `${product.name} - ${session.session_type === "subscription_renewal" ? "Renovação" : "Alteração de assinatura"}`.slice(0, 150),
        payer,
        transactions: { payments: [providerPayment] },
      }),
    }, input.idempotencyKey);
  } catch (error) {
    await admin.from("orders").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("id", order.id);
    await admin.from("payments").update({
      status: "rejected",
      status_detail: error instanceof Error ? error.message.slice(0, 500) : "provider_error",
    }).eq("id", paymentRow.id);
    throw error;
  }

  if (!mpOrder.id) throw new HttpError(502, "Mercado Pago retornou uma order incompleta.");
  const { error: checkoutUpdateError } = await admin.from("payment_provider_checkouts")
    .update({ external_checkout_id: mpOrder.id })
    .eq("order_id", order.id);
  if (checkoutUpdateError) throw checkoutUpdateError;

  await syncTransparentOrder({ admin, internalOrderId: order.id, mpOrder });
  return mappedResult(order.id, mpOrder);
}
