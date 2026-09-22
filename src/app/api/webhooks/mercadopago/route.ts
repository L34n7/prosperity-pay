import { NextResponse } from "next/server";
import { env, requireEnv } from "@/lib/env";
import { fetchMercadoPagoOrder, syncTransparentOrder } from "@/lib/checkout/transparent-checkout-service";
import { dispatchPaymentIntegrationEventsSafe } from "@/lib/integrations/payment-events";
import { dispatchPaymentEmailNotificationsSafe } from "@/lib/email/payment-notifications";
import { getPaymentProvider, type ProviderPayment } from "@/lib/payments";
import { getProviderAccessToken } from "@/lib/payments/provider-credentials";
import { verifyMercadoPagoSignature } from "@/lib/payments/providers/mercadopago/webhook-signature";
import { sha256 } from "@/lib/security/hash";
import { createRecurringSnapshot } from "@/lib/subscriptions/recurring-financials";
import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;
type Payload = {
  id?: string | number;
  type?: string;
  action?: string;
  user_id?: string | number;
  data?: { id?: string | number };
};

type RawPayment = {
  status_detail?: string;
  date_approved?: string;
  fee_details?: Array<{ amount?: number }>;
};

type Candidate = { id: string };

function internalSubscriptionStatus(status: "pending" | "authorized" | "paused" | "cancelled") {
  if (status === "authorized") return "active" as const;
  if (status === "paused") return "paused" as const;
  if (status === "cancelled") return "cancelled" as const;
  return "pending" as const;
}

function subscriptionIdFromReference(reference?: string) {
  const match = reference?.match(/^prosperity-subscription:([0-9a-f-]{36})$/i);
  return match?.[1];
}

async function candidates(admin: AdminClient, providerId: string, userId?: string | number) {
  let query = admin.from("payment_provider_connections").select("id")
    .eq("provider_id", providerId).eq("status", "active");
  if (userId) query = query.eq("external_account_id", String(userId));
  const { data, error } = await query.limit(userId ? 1 : 100);
  if (error) throw error;
  return (data ?? []) as Candidate[];
}

async function providerFor(connectionId: string) {
  return getPaymentProvider("mercadopago", await getProviderAccessToken(connectionId));
}

async function reverseFinancials(admin: AdminClient, storedPayment: { id: string }, payment: ProviderPayment) {
  const { data: entries, error } = await admin.from("ledger_entries").select("*")
    .eq("payment_id", storedPayment.id).eq("status", "posted").gt("amount_cents", 0);
  if (error) throw error;
  if (entries?.length) {
    const entryType = payment.status === "refunded" ? "refund" : "chargeback";
    const byAccount = new Map<string, { amount: number; ids: string[]; entry: (typeof entries)[number] }>();
    for (const entry of entries) {
      const group = byAccount.get(entry.account_id) ?? { amount: 0, ids: [], entry };
      group.amount += Number(entry.amount_cents);
      group.ids.push(entry.id);
      byAccount.set(entry.account_id, group);
    }
    const reversal = await admin.from("ledger_entries").upsert([...byAccount.values()].map(({ amount, ids, entry }) => ({
      account_id: entry.account_id,
      order_id: entry.order_id,
      payment_id: entry.payment_id,
      settlement_model: entry.settlement_model,
      entry_type: entryType,
      amount_cents: -amount,
      currency: entry.currency,
      available_at: new Date().toISOString(),
      source_type: entryType,
      source_id: storedPayment.id,
      reference: `${entryType}:${payment.externalId}`,
      metadata: { reversesEntryIds: ids },
    })), { onConflict: "account_id,source_type,source_id,entry_type", ignoreDuplicates: true });
    if (reversal.error) throw reversal.error;
  }
}

async function applyPaymentState(input: {
  admin: AdminClient;
  eventId: string;
  localPaymentId: string;
  payment: ProviderPayment;
  transactionType: string;
}) {
  const { admin, eventId, localPaymentId, payment, transactionType } = input;
  const raw = (payment.raw ?? {}) as RawPayment;
  const providerFeeCents = Math.round((raw.fee_details ?? []).reduce((sum, item) => sum + (item.amount ?? 0), 0) * 100);
  const { data: originalPayment, error: originalError } = await admin.from("payments")
    .select("id,order_id,gross_amount_cents,currency,status")
    .eq("id", localPaymentId).single();
  if (originalError || !originalPayment) throw originalError ?? new Error("Pagamento interno não encontrado.");
  if (Number(originalPayment.gross_amount_cents) !== Math.round(payment.money.amount * 100) || originalPayment.currency !== payment.money.currency) {
    throw new Error("Valor ou moeda do pagamento divergente do pedido.");
  }

  const becameApproved = payment.status === "approved" && originalPayment.status !== "approved";
  const { data: storedPayment, error: paymentError } = await admin.from("payments").update({
    external_payment_id: payment.externalId,
    status: payment.status,
    status_detail: raw.status_detail,
    provider_fee_amount_cents: providerFeeCents,
    paid_at: payment.status === "approved" ? raw.date_approved ?? new Date().toISOString() : undefined,
    refunded_at: payment.status === "refunded" ? new Date().toISOString() : undefined,
    raw_provider_data: payment.raw as never,
  }).eq("id", originalPayment.id).select("id, order_id, status").single();
  if (paymentError || !storedPayment) throw paymentError ?? new Error("Pagamento interno não encontrado.");

  const transaction = await admin.from("payment_transactions").insert({
    payment_id: storedPayment.id,
    provider_event_id: eventId,
    transaction_type: transactionType,
    amount_cents: Math.round(payment.money.amount * 100),
    status: payment.status,
    raw_payload: payment.raw as never,
    occurred_at: new Date().toISOString(),
  });
  if (transaction.error && transaction.error.code !== "23505") throw transaction.error;

  if (payment.status === "approved") {
    const orderUpdate = await admin.from("orders").update({ status: "paid", paid_at: raw.date_approved ?? new Date().toISOString() }).eq("id", storedPayment.order_id);
    if (orderUpdate.error) throw orderUpdate.error;
    const { error } = await admin.rpc("post_payment_financials", { target_payment_id: storedPayment.id });
    if (error) throw error;
  } else if (payment.status === "refunded" || payment.status === "charged_back") {
    await reverseFinancials(admin, storedPayment, payment);
    const updates = await Promise.all([
      admin.from("orders").update({ status: payment.status === "refunded" ? "refunded" : "charged_back" }).eq("id", storedPayment.order_id),
      admin.from("commissions").update({ status: "reversed", reversed_at: new Date().toISOString() }).eq("payment_id", storedPayment.id),
    ]);
    for (const update of updates) if (update.error) throw update.error;
  }

  await Promise.all([
    dispatchPaymentIntegrationEventsSafe(admin, storedPayment.id),
    dispatchPaymentEmailNotificationsSafe(admin, storedPayment.id),
  ]);

  return { storedPayment, becameApproved };
}

async function processOrderEvent(input: {
  admin: AdminClient;
  providerId: string;
  dataId: string;
  eventId: string;
}) {
  const { admin, providerId, dataId, eventId } = input;

  const { data: checkout, error: checkoutError } = await admin.from("payment_provider_checkouts")
    .select("order_id,connection_id")
    .eq("provider_id", providerId)
    .eq("external_checkout_id", dataId)
    .maybeSingle();

  if (checkoutError) {
    throw checkoutError;
  }

  if (!checkout) {
    // A notificação pode chegar antes de persistirmos o external_checkout_id.
    // O retorno 5xx faz o Mercado Pago reenviar o evento.
    throw new Error("Order ainda não vinculada.");
  }

  const mpOrder = await fetchMercadoPagoOrder(checkout.connection_id, dataId);
  await syncTransparentOrder({
    admin,
    internalOrderId: checkout.order_id,
    mpOrder,
    eventId,
  });
}

async function processPaymentEvent(input: {
  admin: AdminClient;
  providerId: string;
  payload: Payload;
  dataId: string;
  eventId: string;
}) {
  const { admin, providerId, payload, dataId, eventId } = input;
  for (const candidate of await candidates(admin, providerId, payload.user_id)) {
    try {
      const provider = await providerFor(candidate.id);
      const payment = await provider.getPayment(dataId);
      const { data: byExternalId } = await admin.from("payments").select("id")
        .eq("connection_id", candidate.id).eq("external_payment_id", payment.externalId).maybeSingle();
      if (byExternalId) {
        await applyPaymentState({ admin, eventId, localPaymentId: byExternalId.id, payment, transactionType: payload.action ?? "payment.updated" });
        return "processed" as const;
      }
      if (subscriptionIdFromReference(payment.externalReference)) {
        return "ignored" as const;
      }
      if (!payment.externalReference) continue;
      const { data: byReference } = await admin.from("payments").select("id")
        .eq("connection_id", candidate.id).eq("external_reference", payment.externalReference).maybeSingle();
      if (!byReference) continue;
      await applyPaymentState({ admin, eventId, localPaymentId: byReference.id, payment, transactionType: payload.action ?? "payment.updated" });
      return "processed" as const;
    } catch {
      // Outra conta Mercado Pago pode não ser proprietária deste recurso.
    }
  }
  throw new Error("Conexão do pagamento não identificada.");
}

async function processSubscriptionEvent(input: {
  admin: AdminClient;
  providerId: string;
  payload: Payload;
  dataId: string;
}) {
  const { admin, providerId, payload, dataId } = input;
  for (const candidate of await candidates(admin, providerId, payload.user_id)) {
    try {
      const provider = await providerFor(candidate.id);
      const subscription = await provider.getSubscription(dataId);
      const internalId = subscriptionIdFromReference(subscription.externalReference);
      let query = admin.from("subscriptions").select("id").eq("provider_id", providerId);
      query = internalId ? query.eq("id", internalId) : query.eq("external_subscription_id", subscription.externalId);
      const { data: stored } = await query.maybeSingle();
      if (!stored) continue;
      const update = await admin.from("subscriptions").update({
        external_subscription_id: subscription.externalId,
        status: internalSubscriptionStatus(subscription.status),
        current_period_end: subscription.nextPaymentDate,
        cancelled_at: subscription.status === "cancelled" ? new Date().toISOString() : undefined,
      }).eq("id", stored.id);
      if (update.error) throw update.error;
      return;
    } catch {
      // Tenta a próxima conexão.
    }
  }
  throw new Error("Conexão da assinatura não identificada.");
}

async function processAuthorizedPaymentEvent(input: {
  admin: AdminClient;
  providerId: string;
  payload: Payload;
  dataId: string;
  eventId: string;
}) {
  const { admin, providerId, payload, dataId, eventId } = input;
  for (const candidate of await candidates(admin, providerId, payload.user_id)) {
    try {
      const provider = await providerFor(candidate.id);
      const invoice = await provider.getAuthorizedPayment(dataId);
      const internalId = subscriptionIdFromReference(invoice.externalReference);
      let subscriptionQuery = admin.from("subscriptions")
        .select("id,order_id,customer_id,offer_id,provider_id,external_subscription_id,status,amount_cents,currency,cycle_number")
        .eq("provider_id", providerId);
      subscriptionQuery = internalId
        ? subscriptionQuery.eq("id", internalId)
        : subscriptionQuery.eq("external_subscription_id", invoice.subscriptionExternalId);
      const { data: subscription } = await subscriptionQuery.maybeSingle();
      if (!subscription) continue;

      if (!invoice.paymentExternalId) {
        const status = invoice.paymentStatus === "rejected" ? "past_due" : subscription.status;
        const update = await admin.from("subscriptions").update({ status }).eq("id", subscription.id);
        if (update.error) throw update.error;
        return;
      }

      const payment = await provider.getPayment(invoice.paymentExternalId);
      const [originOrderResult, offerResult] = await Promise.all([
        admin.from("orders").select("id,product_id,offer_id,producer_id,customer_id,settlement_model,currency").eq("id", subscription.order_id).single(),
        admin.from("offers").select("*").eq("id", subscription.offer_id).single(),
      ]);
      const originOrder = originOrderResult.data;
      const offer = offerResult.data;
      if (!originOrder || !offer) throw originOrderResult.error ?? offerResult.error ?? new Error("Origem da assinatura não encontrada.");
      const { data: product, error: productError } = await admin.from("products").select("*").eq("id", originOrder.product_id).single();
      if (productError || !product) throw productError ?? new Error("Produto da assinatura não encontrado.");

      const amountCents = Math.round(payment.money.amount * 100);
      let orderId = originOrder.id;
      if (subscription.cycle_number > 0) {
        const renewalKey = `subscription:${subscription.id}:invoice:${invoice.externalId}`;
        const { data: existingOrder } = await admin.from("orders").select("id").eq("idempotency_key", renewalKey).maybeSingle();
        if (existingOrder) orderId = existingOrder.id;
        else {
          const { data: renewalOrder, error: renewalError } = await admin.from("orders").insert({
            product_id: originOrder.product_id,
            offer_id: originOrder.offer_id,
            producer_id: originOrder.producer_id,
            customer_id: subscription.customer_id,
            settlement_model: originOrder.settlement_model,
            gross_amount_cents: amountCents,
            currency: subscription.currency,
            idempotency_key: renewalKey,
            status: "pending_payment",
          }).select("id").single();
          if (renewalError || !renewalOrder) throw renewalError ?? new Error("Falha ao criar ciclo recorrente.");
          orderId = renewalOrder.id;
        }
        await createRecurringSnapshot({
          admin,
          orderId,
          originOrderId: originOrder.id,
          grossAmountCents: amountCents,
          currency: subscription.currency,
          cycleNumber: subscription.cycle_number + 1,
          product: product as never,
          offer: offer as never,
        });
      }

      const { data: existingPayment } = await admin.from("payments").select("id,status,order_id")
        .eq("provider_id", providerId).eq("external_payment_id", payment.externalId).maybeSingle();
      let localPaymentId = existingPayment?.id;

      if (!localPaymentId && subscription.cycle_number === 0) {
        const { data: initialPayment } = await admin.from("payments").select("id")
          .eq("order_id", orderId)
          .eq("connection_id", candidate.id)
          .is("external_payment_id", null)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        localPaymentId = initialPayment?.id;
      }

      if (!localPaymentId) {
        const { data: createdPayment, error: createdPaymentError } = await admin.from("payments").insert({
          order_id: orderId,
          provider_id: providerId,
          connection_id: candidate.id,
          external_payment_id: payment.externalId,
          external_reference: `prosperity-subscription:${subscription.id}:invoice:${invoice.externalId}:payment:${payment.externalId}`,
          idempotency_key: `subscription:${subscription.id}:invoice:${invoice.externalId}:payment:${payment.externalId}`,
          status: "pending",
          gross_amount_cents: amountCents,
          currency: subscription.currency,
          raw_provider_data: payment.raw as never,
        }).select("id").single();
        if (createdPaymentError || !createdPayment) throw createdPaymentError ?? new Error("Falha ao registrar pagamento recorrente.");
        localPaymentId = createdPayment.id;
      }

      const result = await applyPaymentState({
        admin,
        eventId,
        localPaymentId,
        payment,
        transactionType: payload.action ?? "subscription_authorized_payment",
      });

      let providerSubscription = await provider.getSubscription(invoice.subscriptionExternalId);
      let cycleNumber = subscription.cycle_number;
      if (result.becameApproved) {
        cycleNumber += 1;
        if (cycleNumber === 1 && offer.first_charge_cents && Number(offer.first_charge_cents) !== Number(offer.price_cents)) {
          providerSubscription = await provider.updateSubscriptionAmount(invoice.subscriptionExternalId, Number(offer.price_cents) / 100, "BRL");
        }
      }
      const nextStatus = payment.status === "approved"
        ? "active"
        : payment.status === "rejected" || payment.status === "cancelled"
          ? "past_due"
          : internalSubscriptionStatus(providerSubscription.status);
      const subscriptionUpdate = await admin.from("subscriptions").update({
        external_subscription_id: invoice.subscriptionExternalId,
        status: nextStatus,
        cycle_number: cycleNumber,
        current_period_start: result.becameApproved ? invoice.debitDate ?? new Date().toISOString() : undefined,
        current_period_end: providerSubscription.nextPaymentDate,
        cancelled_at: providerSubscription.status === "cancelled" ? new Date().toISOString() : undefined,
      }).eq("id", subscription.id);
      if (subscriptionUpdate.error) throw subscriptionUpdate.error;
      return;
    } catch {
      // Tenta a próxima conexão; o recurso só existe na conta coletora correta.
    }
  }
  throw new Error("Fatura recorrente não identificada.");
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  let payload: Payload;
  try { payload = JSON.parse(rawBody) as Payload; } catch { return NextResponse.json({ error: "JSON invalido." }, { status: 400 }); }
  const requestUrl = new URL(request.url);
  const queryDataId =
    requestUrl.searchParams.get("data.id")
    ?? requestUrl.searchParams.get("data_id")
    ?? "";
  const dataId = String(payload.data?.id ?? queryDataId ?? "");
  const supported = new Set(["payment", "order", "orders", "subscription_preapproval", "subscription_authorized_payment"]);
  if (!payload.type || !supported.has(payload.type) || !dataId) return NextResponse.json({ received: true, ignored: true });

  const signature = request.headers.get("x-signature") ?? "";
  const requestId = request.headers.get("x-request-id") ?? "";
  const secret = requireEnv(env.mercadoPagoWebhookSecret, "MERCADO_PAGO_WEBHOOK_SECRET");
  const signatureDataIds = Array.from(new Set([
    queryDataId,
    dataId,
  ].map((value) => String(value || "").trim()).filter(Boolean)));
  const signatureValid = signatureDataIds.some((candidateDataId) =>
    verifyMercadoPagoSignature({
      signature,
      requestId,
      dataId: candidateDataId,
      secret,
    })
  );

  if (!signatureValid) {
    console.warn("[MERCADO PAGO WEBHOOK] Assinatura inválida.", {
      type: payload.type ?? null,
      action: payload.action ?? null,
      hasSignature: Boolean(signature),
      hasRequestId: Boolean(requestId),
      queryDataId: queryDataId || null,
      payloadDataId: dataId || null,
    });
    return NextResponse.json({ error: "Assinatura invalida." }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: provider } = await admin.from("payment_providers").select("id").eq("code", "mercadopago").single();
  if (!provider) return NextResponse.json({ error: "Provedor indisponivel." }, { status: 503 });

  let { data: event, error: eventError } = await admin.from("webhook_events").insert({
    provider_id: provider.id,
    external_event_id: payload.id ? String(payload.id) : requestId,
    external_resource_id: dataId,
    event_type: payload.action ?? payload.type,
    payload_hash: sha256(rawBody),
    payload,
    status: "processing",
    attempts: 1,
  }).select("id").single();
  if (eventError?.code === "23505") {
    const { data: matchingId } = await admin.from("webhook_events").select("id,status,attempts")
      .eq("provider_id", provider.id).eq("external_event_id", payload.id ? String(payload.id) : requestId).maybeSingle();
    const { data: matchingHash } = matchingId ? { data: null } : await admin.from("webhook_events").select("id,status,attempts")
      .eq("provider_id", provider.id).eq("payload_hash", sha256(rawBody)).maybeSingle();
    const existing = matchingId ?? matchingHash;
    if (!existing) return NextResponse.json({ error: "Não foi possível recuperar o evento." }, { status: 503 });
    if (existing.status === "processed" || existing.status === "ignored") return NextResponse.json({ received: true, duplicate: true });
    if (existing.status === "processing") return NextResponse.json({ error: "Evento em processamento." }, { status: 503 });
    const retry = await admin.from("webhook_events").update({ status: "processing", attempts: existing.attempts + 1, error_message: null })
      .eq("id", existing.id).eq("status", "failed").select("id").maybeSingle();
    if (!retry.data) return NextResponse.json({ error: "Evento em processamento." }, { status: 503 });
    event = { id: retry.data.id } as typeof event;
    eventError = null;
  }
  if (eventError || !event) return NextResponse.json({ error: "Falha ao registrar evento." }, { status: 500 });

  try {
    let finalStatus: "processed" | "ignored" = "processed";
    if (payload.type === "payment") {
      finalStatus = await processPaymentEvent({ admin, providerId: provider.id, payload, dataId, eventId: event.id });
    } else if (payload.type === "order" || payload.type === "orders") {
      await processOrderEvent({ admin, providerId: provider.id, dataId, eventId: event.id });
    } else if (payload.type === "subscription_preapproval") {
      await processSubscriptionEvent({ admin, providerId: provider.id, payload, dataId });
    } else if (payload.type === "subscription_authorized_payment") {
      await processAuthorizedPaymentEvent({ admin, providerId: provider.id, payload, dataId, eventId: event.id });
    }
    await admin.from("webhook_events").update({ status: finalStatus, processed_at: new Date().toISOString() }).eq("id", event.id);
    return NextResponse.json({ received: true, ignored: finalStatus === "ignored" });
  } catch (error) {
    await admin.from("webhook_events").update({ status: "failed", error_message: error instanceof Error ? error.message.slice(0, 1000) : "Erro desconhecido" }).eq("id", event.id);
    console.error(error);
    return NextResponse.json({ error: "Falha ao processar notificacao." }, { status: 500 });
  }
}
