import { HttpError } from "@/lib/api/http";
import { env } from "@/lib/env";
import { FinancialDistributionService, type FeeRule } from "@/lib/financial/financial-distribution-service";
import { getProviderAccessToken } from "@/lib/payments/provider-credentials";
import { digits, sha256 } from "@/lib/security/hash";
import { createRecurringSnapshot } from "@/lib/subscriptions/recurring-financials";
import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;
type PaymentMethod = "card" | "pix";
type FeeType = "percentage" | "fixed" | "hybrid";

type TransparentCheckoutInput = {
  offerSlug: string;
  customerName?: string;
  customerEmail: string;
  customerDocument: string;
  refCode?: string;
  idempotencyKey: string;
  paymentMethod: PaymentMethod;
  card?: {
    token: string;
    paymentMethodId: string;
    installments: number;
    issuerId?: string;
  };
};

type Offer = {
  id: string;
  product_id: string;
  name: string;
  price_cents: number;
  first_charge_cents: number | null;
  currency: string;
  billing_type: "one_time" | "recurring";
  billing_interval: "week" | "month" | "year" | null;
  billing_interval_count: number | null;
  max_installments: number;
  payment_card_enabled: boolean;
  payment_pix_enabled: boolean;
  affiliate_enabled: boolean;
  affiliate_commission_type: FeeType;
  affiliate_commission_bps: number;
  affiliate_commission_fixed_cents: number;
  affiliate_recurrence_mode: "first_payment" | "limited_recurring" | "lifetime_recurring";
  affiliate_recurrence_cycles: number | null;
  prosperity_fee_type: FeeType | null;
  prosperity_fee_bps: number | null;
  prosperity_fee_fixed_cents: number | null;
};

type Product = {
  id: string;
  name: string;
  producer_id: string;
  status: string;
  settlement_model: "connected_account" | "prosperity_balance";
  prosperity_fee_type: FeeType;
  prosperity_fee_bps: number;
  prosperity_fee_fixed_cents: number;
};

type MpPayment = {
  id?: string;
  amount?: string | number;
  paid_amount?: string | number;
  status?: string;
  status_detail?: string;
  payment_method?: {
    id?: string;
    type?: string;
    ticket_url?: string;
    qr_code?: string;
    qr_code_base64?: string;
  };
  automatic_payments?: { payment_profile_id?: string };
};

export type MercadoPagoOrder = {
  id?: string;
  status?: string;
  status_detail?: string;
  total_amount?: string | number;
  last_updated_date?: string;
  transactions?: { payments?: MpPayment[] };
};

type MercadoPagoPreapproval = {
  id?: string;
  status?: string;
  external_reference?: string | null;
  next_payment_date?: string;
  auto_recurring?: {
    transaction_amount?: number | string;
    currency_id?: string;
  };
};

function rule(type: FeeType, basisPoints: number, fixedCents: number): FeeRule {
  return { type, basisPoints, fixedCents };
}

function money(cents: number) {
  return (cents / 100).toFixed(2);
}

function mappedStatus(status?: string) {
  switch (status) {
    case "processed": return "approved" as const;
    case "processing": return "processing" as const;
    case "failed": return "rejected" as const;
    case "canceled":
    case "cancelled": return "cancelled" as const;
    case "refunded": return "refunded" as const;
    default: return "pending" as const;
  }
}

function periodEnd(start: Date, offer: Pick<Offer, "billing_interval" | "billing_interval_count">) {
  const end = new Date(start);
  const count = Math.max(1, Number(offer.billing_interval_count ?? 1));
  if (offer.billing_interval === "week") end.setUTCDate(end.getUTCDate() + count * 7);
  else if (offer.billing_interval === "year") end.setUTCFullYear(end.getUTCFullYear() + count);
  else end.setUTCMonth(end.getUTCMonth() + count);
  return end;
}

function subscriptionFrequency(offer: Offer) {
  const count = Math.max(1, Number(offer.billing_interval_count ?? 1));
  if (offer.billing_interval === "week") {
    return { frequency: count * 7, frequencyType: "days" as const };
  }
  if (offer.billing_interval === "year") {
    return { frequency: count * 12, frequencyType: "months" as const };
  }
  return { frequency: count, frequencyType: "months" as const };
}

function checkoutStatusFromOrder(status: string) {
  if (status === "paid") return "approved";
  if (status === "cancelled" || status === "expired" || status === "refunded" || status === "charged_back") return "cancelled";
  return "pending";
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
  const body = await response.json() as T & { message?: string; error?: string; status?: number };
  if (!response.ok) {
    console.error("[mercadopago] request rejected", { path, status: response.status, error: body.error, message: body.message });
    throw new HttpError(502, body.message || body.error || `Mercado Pago respondeu HTTP ${response.status}.`);
  }
  return body;
}

async function selectCentralConnection(admin: AdminClient, product: Product) {
  if (product.settlement_model !== "prosperity_balance") {
    throw new HttpError(409, "Checkout transparente central disponível somente para ofertas com Saldo Prosperity.");
  }
  const { data, error } = await admin.from("payment_provider_connections")
    .select("id,provider_id,live_mode")
    .eq("connection_kind", "prosperity_balance")
    .is("owner_user_id", null)
    .eq("status", "active")
    .single();
  if (error || !data) throw new HttpError(503, "Conta Mercado Pago central não configurada.");
  return data;
}

function subscriptionPayerEmail(connection: { live_mode?: boolean | null }, customerEmail: string) {
  if (connection.live_mode !== false) return customerEmail;
  const testPayerEmail = env.mercadoPagoTestPayerEmail?.trim().toLowerCase();
  if (!testPayerEmail) {
    throw new HttpError(503, "Configure MERCADO_PAGO_TEST_PAYER_EMAIL com o e-mail da conta Comprador Teste do mesmo país da conta Vendedor Teste.");
  }
  return testPayerEmail;
}

async function resolveCustomer(admin: AdminClient, input: TransparentCheckoutInput) {
  const email = input.customerEmail.trim().toLowerCase();
  const document = digits(input.customerDocument);
  if (document.length !== 11) throw new HttpError(400, "CPF inválido.");

  const { data: existing } = await admin.from("customers")
    .select("id,email,name,external_customer_id")
    .eq("email", email)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing) {
    const { error } = await admin.from("customers").update({
      name: input.customerName || existing.name,
      document_hash: sha256(document),
    }).eq("id", existing.id);
    if (error) throw error;
    return { ...existing, email, document };
  }

  const { data: customer, error } = await admin.from("customers").insert({
    email,
    name: input.customerName,
    document_hash: sha256(document),
  }).select("id,email,name,external_customer_id").single();
  if (error || !customer) throw error ?? new Error("Falha ao registrar comprador.");
  return { ...customer, email, document };
}

async function resolveAffiliate(admin: AdminClient, refCode: string | undefined, offer: Offer, product: Product) {
  if (!refCode || !offer.affiliate_enabled) return undefined;
  const { data: link } = await admin.from("affiliate_links")
    .select("id,membership_id,affiliate_memberships!inner(user_id,status,affiliate_programs!inner(product_id,active))")
    .eq("ref_code", refCode).eq("active", true).maybeSingle();
  const membership = link?.affiliate_memberships;
  if (!link || !membership || Array.isArray(membership) || membership.status !== "active" || membership.affiliate_programs?.product_id !== product.id || !membership.affiliate_programs.active) return undefined;
  return { linkId: link.id, membershipId: link.membership_id, userId: membership.user_id };
}

async function createFinancialSnapshot(admin: AdminClient, orderId: string, offer: Offer, product: Product, affiliateUserId?: string) {
  const { data: participants, error: participantError } = await admin.from("product_participants")
    .select("user_id,participation_bps,offer_id")
    .eq("product_id", product.id).eq("active", true)
    .or(`offer_id.is.null,offer_id.eq.${offer.id}`);
  if (participantError) throw participantError;

  const result = new FinancialDistributionService().calculate({
    grossAmountCents: Number(offer.price_cents),
    gatewayFeeCents: 0,
    settlementModel: product.settlement_model,
    producerId: product.producer_id,
    prosperityFee: rule(
      offer.prosperity_fee_type ?? product.prosperity_fee_type,
      Number(offer.prosperity_fee_bps ?? product.prosperity_fee_bps),
      Number(offer.prosperity_fee_fixed_cents ?? product.prosperity_fee_fixed_cents),
    ),
    affiliate: affiliateUserId ? {
      userId: affiliateUserId,
      rule: rule(offer.affiliate_commission_type, Number(offer.affiliate_commission_bps), Number(offer.affiliate_commission_fixed_cents)),
    } : undefined,
    coproducers: (participants ?? []).map((item) => ({ userId: item.user_id, basisPoints: item.participation_bps })),
  });

  const { data: snapshot, error: snapshotError } = await admin.from("financial_snapshots").insert({
    order_id: orderId,
    settlement_model: product.settlement_model,
    currency: offer.currency,
    gross_amount_cents: result.grossAmountCents,
    gateway_fee_amount_cents: 0,
    prosperity_fee_amount_cents: result.prosperityFeeCents,
    affiliate_amount_cents: result.affiliateCents,
    coproducer_amount_cents: result.coproducerCents,
    producer_amount_cents: result.producerCents,
    prosperity_split_amount_cents: result.prosperitySplitCents,
    rules: { calculationVersion: 1, gatewayFeePendingReconciliation: true, affiliateSuppressedByCoproduction: result.affiliateSuppressedByCoproduction },
  }).select("id").single();
  if (snapshotError || !snapshot) throw snapshotError ?? new Error("Falha ao calcular distribuição financeira.");

  const allocations = result.allocations.filter((item) => item.amountCents > 0).map((item) => ({
    snapshot_id: snapshot.id,
    allocation_type: item.type,
    destination: item.destination,
    beneficiary_user_id: item.beneficiaryUserId,
    amount_cents: item.amountCents,
    currency: offer.currency,
    rule_snapshot: item.ruleSnapshot,
  }));
  if (allocations.length) {
    const { error } = await admin.from("financial_allocations").insert(allocations);
    if (error) throw error;
  }
}

async function createInternalOrder(admin: AdminClient, input: TransparentCheckoutInput, offer: Offer, product: Product) {
  const connection = await selectCentralConnection(admin, product);
  const customer = await resolveCustomer(admin, input);
  const affiliate = await resolveAffiliate(admin, input.refCode, offer, product);
  const amountCents = offer.billing_type === "recurring" ? Number(offer.first_charge_cents ?? offer.price_cents) : Number(offer.price_cents);

  const { data: order, error: orderError } = await admin.from("orders").insert({
    product_id: product.id,
    offer_id: offer.id,
    producer_id: product.producer_id,
    customer_id: customer.id,
    settlement_model: product.settlement_model,
    gross_amount_cents: amountCents,
    currency: offer.currency,
    idempotency_key: input.idempotencyKey,
    status: "draft",
  }).select("id").single();
  if (orderError || !order) throw orderError ?? new Error("Falha ao criar pedido.");

  if (affiliate) {
    const { error } = await admin.from("affiliate_attributions").insert({
      affiliate_link_id: affiliate.linkId,
      affiliate_membership_id: affiliate.membershipId,
      order_id: order.id,
      ref_code: input.refCode!,
      expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    });
    if (error) throw error;
  }

  if (offer.billing_type === "recurring") {
    await createRecurringSnapshot({
      admin,
      orderId: order.id,
      originOrderId: order.id,
      grossAmountCents: amountCents,
      currency: offer.currency,
      cycleNumber: 1,
      product,
      offer,
    });
  } else {
    await createFinancialSnapshot(admin, order.id, offer, product, affiliate?.userId);
  }

  const paymentId = crypto.randomUUID();
  const { data: payment, error: paymentError } = await admin.from("payments").insert({
    id: paymentId,
    order_id: order.id,
    provider_id: connection.provider_id,
    connection_id: connection.id,
    external_reference: `prosperity:${paymentId}`,
    idempotency_key: `${input.idempotencyKey}:payment`,
    gross_amount_cents: amountCents,
    currency: offer.currency,
    status: "pending",
  }).select("id,status").single();
  if (paymentError || !payment) throw paymentError ?? new Error("Falha ao registrar pagamento.");

  let subscriptionId: string | undefined;
  if (offer.billing_type === "recurring") {
    const { data: subscription, error } = await admin.from("subscriptions").insert({
      order_id: order.id,
      customer_id: customer.id,
      offer_id: offer.id,
      provider_id: connection.provider_id,
      status: "pending",
      amount_cents: offer.price_cents,
      currency: offer.currency,
      cycle_number: 0,
    }).select("id").single();
    if (error || !subscription) throw error ?? new Error("Falha ao registrar assinatura.");
    subscriptionId = subscription.id;
  }

  const { error: checkoutError } = await admin.from("payment_provider_checkouts").insert({
    order_id: order.id,
    provider_id: connection.provider_id,
    connection_id: connection.id,
    idempotency_key: `${input.idempotencyKey}:transparent`,
  });
  if (checkoutError) throw checkoutError;

  return { order, payment, connection, customer, amountCents, subscriptionId };
}

function transparentResult(orderId: string, paymentStatus: string, mpOrder: MercadoPagoOrder) {
  const transaction = mpOrder.transactions?.payments?.[0];
  return {
    orderId,
    status: paymentStatus,
    providerOrderId: mpOrder.id,
    qrCode: transaction?.payment_method?.qr_code,
    qrCodeBase64: transaction?.payment_method?.qr_code_base64,
    ticketUrl: transaction?.payment_method?.ticket_url,
  };
}

export async function syncTransparentOrder(input: {
  admin: AdminClient;
  internalOrderId: string;
  mpOrder: MercadoPagoOrder;
  eventId?: string;
}) {
  const { admin, internalOrderId, mpOrder } = input;
  const transaction = mpOrder.transactions?.payments?.[0];
  if (!transaction) throw new Error("Order do Mercado Pago sem transação de pagamento.");

  const status = mappedStatus(transaction.status ?? mpOrder.status);
  const amountCents = Math.round(Number(transaction.amount ?? mpOrder.total_amount ?? 0) * 100);
  const paidAmount = transaction.paid_amount == null ? undefined : Math.round(Number(transaction.paid_amount) * 100);
  const providerFeeCents = paidAmount == null ? 0 : Math.max(0, amountCents - paidAmount);
  const { data: currentPayment, error: currentError } = await admin.from("payments")
    .select("id,status,gross_amount_cents")
    .eq("order_id", internalOrderId)
    .order("created_at", { ascending: true })
    .limit(1)
    .single();
  if (currentError || !currentPayment) throw currentError ?? new Error("Pagamento interno não encontrado.");

  const becameApproved = status === "approved" && currentPayment.status !== "approved";
  const paidAt = status === "approved" ? mpOrder.last_updated_date ?? new Date().toISOString() : undefined;
  const { error: paymentError } = await admin.from("payments").update({
    external_payment_id: transaction.id,
    status,
    status_detail: transaction.status_detail ?? mpOrder.status_detail,
    provider_fee_amount_cents: providerFeeCents,
    paid_at: paidAt,
    refunded_at: status === "refunded" ? new Date().toISOString() : undefined,
    raw_provider_data: mpOrder as never,
  }).eq("id", currentPayment.id);
  if (paymentError) throw paymentError;

  if (input.eventId) {
    const { error } = await admin.from("payment_transactions").insert({
      payment_id: currentPayment.id,
      provider_event_id: input.eventId,
      transaction_type: "order.updated",
      amount_cents: amountCents || Number(currentPayment.gross_amount_cents),
      status,
      raw_payload: mpOrder as never,
      occurred_at: new Date().toISOString(),
    });
    if (error && error.code !== "23505") throw error;
  }

  if (status === "approved") {
    const { error: orderError } = await admin.from("orders").update({ status: "paid", paid_at: paidAt }).eq("id", internalOrderId);
    if (orderError) throw orderError;
    if (becameApproved) {
      const { error } = await admin.rpc("post_payment_financials", { target_payment_id: currentPayment.id });
      if (error) throw error;
    }

    const { data: subscription } = await admin.from("subscriptions")
      .select("id,offer_id,cycle_number")
      .eq("order_id", internalOrderId)
      .maybeSingle();
    if (subscription) {
      const { data: storedOffer } = await admin.from("offers")
        .select("billing_interval,billing_interval_count")
        .eq("id", subscription.offer_id).single();
      const start = new Date(paidAt ?? Date.now());
      const profileId = transaction.automatic_payments?.payment_profile_id;
      const { error } = await admin.from("subscriptions").update({
        status: "active",
        cycle_number: Math.max(1, Number(subscription.cycle_number)),
        current_period_start: start.toISOString(),
        current_period_end: periodEnd(start, (storedOffer ?? { billing_interval: "month", billing_interval_count: 1 }) as Pick<Offer, "billing_interval" | "billing_interval_count">).toISOString(),
        payment_profile_id: profileId || undefined,
      }).eq("id", subscription.id);
      if (error) throw error;
    }
  } else if (status === "cancelled") {
    await admin.from("orders").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("id", internalOrderId);
  } else if (status === "refunded") {
    await admin.from("orders").update({ status: "refunded" }).eq("id", internalOrderId);
  } else {
    await admin.from("orders").update({ status: "pending_payment" }).eq("id", internalOrderId);
  }

  return transparentResult(internalOrderId, status, mpOrder);
}

export async function fetchMercadoPagoOrder(connectionId: string, externalOrderId: string) {
  const token = await getProviderAccessToken(connectionId);
  return mpRequest<MercadoPagoOrder>(token, `/v1/orders/${encodeURIComponent(externalOrderId)}`);
}

async function createAuthorizedCardSubscription(input: {
  admin: AdminClient;
  token: string;
  internal: Awaited<ReturnType<typeof createInternalOrder>>;
  checkoutInput: TransparentCheckoutInput;
  offer: Offer;
  product: Product;
}) {
  const { admin, token, internal, checkoutInput, offer, product } = input;
  if (!internal.subscriptionId || !checkoutInput.card?.token) {
    throw new HttpError(500, "Assinatura interna não preparada para cobrança recorrente.");
  }

  const { frequency, frequencyType } = subscriptionFrequency(offer);
  const appUrl = env.appUrl ?? "https://prosperity-pay.vercel.app";
  const payerEmail = subscriptionPayerEmail(internal.connection, internal.customer.email);
  let preapproval: MercadoPagoPreapproval;

  try {
    preapproval = await mpRequest<MercadoPagoPreapproval>(token, "/preapproval", {
      method: "POST",
      body: JSON.stringify({
        reason: `${product.name} - ${offer.name}`.slice(0, 255),
        external_reference: `prosperity-subscription:${internal.subscriptionId}`,
        payer_email: payerEmail,
        card_token_id: checkoutInput.card.token,
        auto_recurring: {
          frequency,
          frequency_type: frequencyType,
          transaction_amount: internal.amountCents / 100,
          currency_id: offer.currency,
        },
        back_url: `${appUrl}/checkout/sucesso?order=${internal.order.id}`,
        status: "authorized",
      }),
    }, `${checkoutInput.idempotencyKey}:preapproval`);
  } catch (error) {
    await Promise.all([
      admin.from("orders").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("id", internal.order.id),
      admin.from("payments").update({ status: "rejected", status_detail: error instanceof Error ? error.message.slice(0, 500) : "provider_error" }).eq("id", internal.payment.id),
      admin.from("subscriptions").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("id", internal.subscriptionId),
    ]);
    throw error;
  }

  if (!preapproval.id) throw new HttpError(502, "Mercado Pago retornou assinatura incompleta.");

  const updates = await Promise.all([
    admin.from("subscriptions").update({
      external_subscription_id: preapproval.id,
      status: preapproval.status === "authorized" ? "active" : "pending",
      current_period_end: preapproval.next_payment_date,
    }).eq("id", internal.subscriptionId),
    admin.from("payment_provider_checkouts").update({ external_checkout_id: preapproval.id }).eq("order_id", internal.order.id),
    admin.from("orders").update({ status: "pending_payment" }).eq("id", internal.order.id),
  ]);
  for (const update of updates) if (update.error) throw update.error;

  return {
    orderId: internal.order.id,
    status: "pending",
    providerOrderId: preapproval.id,
  };
}

export async function createTransparentCheckout(input: TransparentCheckoutInput) {
  const admin = createAdminClient();
  const { data: existing } = await admin.from("orders")
    .select("id,status,payment_provider_checkouts(connection_id,external_checkout_id),payments(status,raw_provider_data)")
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();
  if (existing) {
    const checkout = Array.isArray(existing.payment_provider_checkouts) ? existing.payment_provider_checkouts[0] : existing.payment_provider_checkouts;
    if (checkout?.external_checkout_id?.startsWith("ORD")) {
      const mpOrder = await fetchMercadoPagoOrder(checkout.connection_id, checkout.external_checkout_id);
      return syncTransparentOrder({ admin, internalOrderId: existing.id, mpOrder });
    }
    if (checkout?.external_checkout_id) {
      return {
        orderId: existing.id,
        status: checkoutStatusFromOrder(existing.status),
        providerOrderId: checkout.external_checkout_id,
      };
    }
    throw new HttpError(409, "Tentativa anterior incompleta. Tente novamente.");
  }

  const { data: rawOffer, error: offerError } = await admin.from("offers")
    .select("*,products(*)")
    .eq("checkout_slug", input.offerSlug)
    .eq("status", "active")
    .single();
  if (offerError || !rawOffer || !rawOffer.products || Array.isArray(rawOffer.products)) throw new HttpError(404, "Oferta ativa não encontrada.");
  const offer = rawOffer as unknown as Offer & { products: Product };
  const product = offer.products;
  if (product.status !== "active") throw new HttpError(409, "Produto indisponível para venda.");
  if (input.paymentMethod === "card" && !offer.payment_card_enabled) throw new HttpError(409, "Pagamento por cartão não está habilitado nesta oferta.");
  if (input.paymentMethod === "pix" && !offer.payment_pix_enabled) throw new HttpError(409, "Pagamento por PIX não está habilitado nesta oferta.");
  if (input.paymentMethod === "card" && (!input.card?.token || !input.card.paymentMethodId)) throw new HttpError(400, "Dados tokenizados do cartão ausentes.");
  if (input.paymentMethod === "card" && offer.billing_type === "recurring" && Number(input.card?.installments ?? 1) !== 1) {
    throw new HttpError(400, "Assinaturas recorrentes devem ser cobradas em 1x por ciclo.");
  }
  if (input.paymentMethod === "card" && Number(input.card?.installments ?? 1) > Number(offer.max_installments)) {
    throw new HttpError(400, "Quantidade de parcelas acima do limite da oferta.");
  }

  const internal = await createInternalOrder(admin, input, offer, product);
  const token = await getProviderAccessToken(internal.connection.id);

  if (offer.billing_type === "recurring" && input.paymentMethod === "card") {
    return createAuthorizedCardSubscription({ admin, token, internal, checkoutInput: input, offer, product });
  }

  const payer: Record<string, unknown> = {
    email: internal.customer.email,
    identification: { type: "CPF", number: internal.customer.document },
  };
  const payment = input.paymentMethod === "card" ? {
    amount: money(internal.amountCents),
    payment_method: {
      id: input.card!.paymentMethodId,
      type: "credit_card",
      token: input.card!.token,
      installments: Math.max(1, Number(input.card!.installments || 1)),
    },
  } : {
    amount: money(internal.amountCents),
    payment_method: { id: "pix", type: "bank_transfer" },
    expiration_time: "P1D",
  };

  let mpOrder: MercadoPagoOrder;
  try {
    mpOrder = await mpRequest<MercadoPagoOrder>(token, "/v1/orders", {
      method: "POST",
      body: JSON.stringify({
        type: "online",
        processing_mode: "automatic",
        total_amount: money(internal.amountCents),
        external_reference: `prosperity-${internal.order.id}`,
        description: `${product.name} - ${offer.name}`.slice(0, 150),
        payer,
        transactions: { payments: [payment] },
      }),
    }, input.idempotencyKey);
  } catch (error) {
    await admin.from("orders").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("id", internal.order.id);
    await admin.from("payments").update({ status: "rejected", status_detail: error instanceof Error ? error.message.slice(0, 500) : "provider_error" }).eq("id", internal.payment.id);
    throw error;
  }

  if (!mpOrder.id) throw new HttpError(502, "Mercado Pago retornou uma order incompleta.");
  const { error: checkoutUpdateError } = await admin.from("payment_provider_checkouts").update({
    external_checkout_id: mpOrder.id,
  }).eq("order_id", internal.order.id);
  if (checkoutUpdateError) throw checkoutUpdateError;

  return syncTransparentOrder({ admin, internalOrderId: internal.order.id, mpOrder });
}
