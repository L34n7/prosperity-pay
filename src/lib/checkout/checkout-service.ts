import { HttpError } from "@/lib/api/http";
import { resolveOfferCommissionOverride } from "@/lib/affiliates/offer-commission-overrides";
import { env, requireEnv } from "@/lib/env";
import { FinancialDistributionService, type FeeRule } from "@/lib/financial/financial-distribution-service";
import { getPaymentProvider } from "@/lib/payments";
import { getProviderAccessToken } from "@/lib/payments/provider-credentials";
import { createRecurringSnapshot } from "@/lib/subscriptions/recurring-financials";
import { createAdminClient } from "@/lib/supabase/admin";

type CheckoutPaymentMethod = "card" | "pix";

type CheckoutRequest = {
  offerSlug: string;
  customerName?: string;
  customerEmail: string;
  refCode?: string;
  idempotencyKey: string;
};

type CheckoutOfferSettings = {
  max_installments: number;
  payment_card_enabled: boolean;
  payment_pix_enabled: boolean;
  primary_payment_method: CheckoutPaymentMethod;
  affiliate_enabled: boolean;
};

type CommercialOffer = CheckoutOfferSettings & {
  id: string;
  product_id: string;
  name: string;
  price_cents: number;
  currency: string;
  billing_type: "one_time" | "recurring";
  billing_interval: string | null;
  billing_interval_count: number | null;
  first_charge_cents: number | null;
  affiliate_commission_type: "percentage" | "fixed" | "hybrid";
  affiliate_commission_bps: number;
  affiliate_commission_fixed_cents: number;
  affiliate_recurrence_mode: "first_payment" | "limited_recurring" | "lifetime_recurring";
  affiliate_recurrence_cycles: number | null;
  prosperity_fee_type: "percentage" | "fixed" | "hybrid" | null;
  prosperity_fee_bps: number | null;
  prosperity_fee_fixed_cents: number | null;
};

type CommercialProduct = {
  id: string;
  name: string;
  producer_id: string;
  status: string;
  settlement_model: "connected_account" | "prosperity_balance";
  prosperity_fee_type: "percentage" | "fixed" | "hybrid";
  prosperity_fee_bps: number;
  prosperity_fee_fixed_cents: number;
};

function rule(type: "percentage" | "fixed" | "hybrid", basisPoints: number, fixedCents: number): FeeRule {
  return { type, basisPoints, fixedCents };
}

function affiliateCommissionRule(offer: CommercialOffer, overrideBasisPoints: number | null | undefined): FeeRule {
  if (overrideBasisPoints !== null && overrideBasisPoints !== undefined) {
    return rule("percentage", Number(overrideBasisPoints), 0);
  }
  return rule(offer.affiliate_commission_type, Number(offer.affiliate_commission_bps), Number(offer.affiliate_commission_fixed_cents));
}

function paymentMethods(offer: CheckoutOfferSettings) {
  return {
    card: offer.payment_card_enabled,
    pix: offer.payment_pix_enabled,
    primary: offer.primary_payment_method,
  };
}

function subscriptionFrequency(offer: Pick<CommercialOffer, "billing_interval" | "billing_interval_count">) {
  const count = Number(offer.billing_interval_count ?? 1);
  if (offer.billing_interval === "week") return { frequency: count * 7, frequencyType: "days" as const };
  if (offer.billing_interval === "year") return { frequency: count * 12, frequencyType: "months" as const };
  return { frequency: count, frequencyType: "months" as const };
}

async function selectConnection(admin: ReturnType<typeof createAdminClient>, product: CommercialProduct) {
  if (product.settlement_model === "connected_account") {
    const query = await admin.from("payment_provider_connections").select("id, provider_id")
      .eq("connection_kind", "connected_account").eq("owner_user_id", product.producer_id)
      .eq("status", "active").single();
    if (query.error || !query.data) throw new HttpError(409, "O produtor precisa conectar o Mercado Pago antes de vender.");
    return query.data;
  }
  const query = await admin.from("payment_provider_connections").select("id, provider_id")
    .eq("connection_kind", "prosperity_balance").is("owner_user_id", null)
    .eq("status", "active").single();
  if (query.error || !query.data) throw new HttpError(503, "Conta Mercado Pago da Prosperity ainda nao configurada.");
  return query.data;
}

async function resolveAffiliate(admin: ReturnType<typeof createAdminClient>, input: CheckoutRequest, offer: CommercialOffer, product: CommercialProduct) {
  if (!input.refCode || !offer.affiliate_enabled) return undefined;
  const { data: link } = await admin.from("affiliate_links")
    .select("id, membership_id, affiliate_memberships!inner(user_id, status, affiliate_commission_bps_override, affiliate_programs!inner(product_id, active))")
    .eq("ref_code", input.refCode).eq("active", true).maybeSingle();
  const membership = link?.affiliate_memberships;
  if (!link || !membership || Array.isArray(membership) || membership.status !== "active" || membership.affiliate_programs?.product_id !== product.id || !membership.affiliate_programs.active) return undefined;
  return { linkId: link.id, membershipId: link.membership_id };
}

async function createRecurringOrderBase(
  admin: ReturnType<typeof createAdminClient>,
  input: CheckoutRequest,
  offer: CommercialOffer,
  product: CommercialProduct,
) {
  const selectedConnection = await selectConnection(admin, product);
  const initialAmountCents = Number(offer.first_charge_cents ?? offer.price_cents);
  const affiliate = await resolveAffiliate(admin, input, offer, product);

  const { data: customer, error: customerError } = await admin.from("customers").insert({
    email: input.customerEmail.toLowerCase(), name: input.customerName,
  }).select("id").single();
  if (customerError || !customer) throw customerError ?? new Error("Falha ao criar cliente.");

  const { data: order, error: orderError } = await admin.from("orders").insert({
    product_id: product.id,
    offer_id: offer.id,
    producer_id: product.producer_id,
    customer_id: customer.id,
    settlement_model: product.settlement_model,
    gross_amount_cents: initialAmountCents,
    currency: offer.currency,
    idempotency_key: input.idempotencyKey,
    status: "draft",
  }).select("id").single();
  if (orderError || !order) throw orderError ?? new Error("Falha ao criar pedido.");

  if (affiliate) {
    const { error: attributionError } = await admin.from("affiliate_attributions").insert({
      affiliate_link_id: affiliate.linkId,
      affiliate_membership_id: affiliate.membershipId,
      order_id: order.id,
      ref_code: input.refCode!,
      expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    });
    if (attributionError) throw attributionError;
  }

  await createRecurringSnapshot({
    admin,
    orderId: order.id,
    originOrderId: order.id,
    grossAmountCents: initialAmountCents,
    currency: offer.currency,
    cycleNumber: 1,
    product,
    offer,
  });

  return { selectedConnection, customer, order, initialAmountCents };
}

async function createRecurringCheckout(
  admin: ReturnType<typeof createAdminClient>,
  input: CheckoutRequest,
  offer: CommercialOffer,
  product: CommercialProduct,
) {
  if (!offer.billing_interval || !offer.billing_interval_count) throw new HttpError(409, "Frequência da assinatura não configurada.");
  const { selectedConnection, customer, order, initialAmountCents } = await createRecurringOrderBase(admin, input, offer, product);

  const { data: subscription, error: subscriptionError } = await admin.from("subscriptions").insert({
    order_id: order.id,
    customer_id: customer.id,
    offer_id: offer.id,
    provider_id: selectedConnection.provider_id,
    status: "pending",
    amount_cents: offer.price_cents,
    currency: offer.currency,
    cycle_number: 0,
  }).select("id").single();
  if (subscriptionError || !subscription) throw subscriptionError ?? new Error("Falha ao criar assinatura.");

  const checkoutIdempotency = `${input.idempotencyKey}:subscription-plan`;
  const { data: checkoutRecord, error: checkoutRecordError } = await admin.from("payment_provider_checkouts").insert({
    order_id: order.id,
    provider_id: selectedConnection.provider_id,
    connection_id: selectedConnection.id,
    idempotency_key: checkoutIdempotency,
  }).select("id").single();
  if (checkoutRecordError || !checkoutRecord) throw checkoutRecordError ?? new Error("Falha ao preparar checkout.");

  const provider = getPaymentProvider("mercadopago", await getProviderAccessToken(selectedConnection.id));
  const appUrl = requireEnv(env.appUrl, "NEXT_PUBLIC_APP_URL");
  const frequency = subscriptionFrequency(offer);
  const plan = await provider.createSubscriptionPlan({
    externalReference: `prosperity-subscription:${subscription.id}`,
    idempotencyKey: checkoutIdempotency,
    reason: `${product.name} — ${offer.name}`,
    money: { amount: initialAmountCents / 100, currency: "BRL" },
    frequency: frequency.frequency,
    frequencyType: frequency.frequencyType,
    backUrl: `${appUrl}/checkout/sucesso?order=${order.id}`,
  });

  const updates = await Promise.all([
    admin.from("payment_provider_checkouts").update({
      external_checkout_id: plan.externalId,
      checkout_url: plan.checkoutUrl,
    }).eq("id", checkoutRecord.id),
    admin.from("orders").update({ status: "pending_payment" }).eq("id", order.id),
  ]);
  for (const update of updates) if (update.error) throw update.error;
  return { orderId: order.id, checkoutUrl: plan.checkoutUrl, reused: false };
}

export async function createCheckout(input: CheckoutRequest) {
  const admin = createAdminClient();
  const { data: existing } = await admin.from("orders")
    .select("id, payment_provider_checkouts(checkout_url, external_checkout_id)")
    .eq("idempotency_key", input.idempotencyKey).maybeSingle();
  if (existing) {
    const checkout = Array.isArray(existing.payment_provider_checkouts) ? existing.payment_provider_checkouts[0] : existing.payment_provider_checkouts;
    if (checkout?.checkout_url) return { orderId: existing.id, checkoutUrl: checkout.checkout_url, reused: true };

    const [orderResult, checkoutResult] = await Promise.all([
      admin.from("orders").select("id,gross_amount_cents,settlement_model,products(name),offers!orders_offer_id_fkey(*),customers(email),financial_snapshots(prosperity_split_amount_cents)").eq("id", existing.id).single(),
      admin.from("payment_provider_checkouts").select("id,idempotency_key,connection_id,external_checkout_id").eq("order_id", existing.id).single(),
    ]);
    const order = orderResult.data;
    const record = checkoutResult.data;
    if (!order || !record) throw new HttpError(409, "O pedido não foi concluído. Inicie outra tentativa de pagamento.");
    const storedOffer = order.offers as unknown as CommercialOffer;
    const provider = getPaymentProvider("mercadopago", await getProviderAccessToken(record.connection_id));
    const appUrl = requireEnv(env.appUrl, "NEXT_PUBLIC_APP_URL");

    if (storedOffer.billing_type === "recurring") {
      const { data: subscription } = await admin.from("subscriptions").select("id").eq("order_id", existing.id).single();
      if (!subscription) throw new HttpError(409, "Assinatura não encontrada para este pedido.");
      const frequency = subscriptionFrequency(storedOffer);
      const plan = record.external_checkout_id
        ? await provider.getSubscriptionPlan(record.external_checkout_id)
        : await provider.createSubscriptionPlan({
            externalReference: `prosperity-subscription:${subscription.id}`,
            idempotencyKey: record.idempotency_key,
            reason: `${order.products.name} — ${storedOffer.name}`,
            money: { amount: Number(order.gross_amount_cents) / 100, currency: "BRL" },
            frequency: frequency.frequency,
            frequencyType: frequency.frequencyType,
            backUrl: `${appUrl}/checkout/sucesso?order=${order.id}`,
          });
      const updates = await Promise.all([
        admin.from("payment_provider_checkouts").update({ external_checkout_id: plan.externalId, checkout_url: plan.checkoutUrl }).eq("id", record.id),
        admin.from("orders").update({ status: "pending_payment" }).eq("id", order.id),
      ]);
      for (const update of updates) if (update.error) throw update.error;
      return { orderId: order.id, checkoutUrl: plan.checkoutUrl, reused: true };
    }

    const { data: storedPayment } = await admin.from("payments").select("id,connection_id,external_reference").eq("order_id", existing.id).single();
    if (!storedPayment) throw new HttpError(409, "O pedido não foi concluído. Inicie outra tentativa de pagamento.");
    const created = await provider.createCheckout({
      externalReference: storedPayment.external_reference,
      idempotencyKey: record.idempotency_key,
      title: `${order.products.name} — ${storedOffer.name}`,
      money: { amount: Number(order.gross_amount_cents) / 100, currency: "BRL" },
      notificationUrl: `${appUrl}/api/webhooks/mercadopago?source_news=webhooks`,
      successUrl: `${appUrl}/checkout/sucesso?order=${order.id}`,
      failureUrl: `${appUrl}/checkout/falha?order=${order.id}`,
      pendingUrl: `${appUrl}/checkout/pendente?order=${order.id}`,
      marketplaceFeeAmount: order.settlement_model === "connected_account" ? Number(order.financial_snapshots?.prosperity_split_amount_cents ?? 0) / 100 : undefined,
      maxInstallments: storedOffer.payment_card_enabled ? Number(storedOffer.max_installments) : 1,
      paymentMethods: paymentMethods(storedOffer),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    const save = await admin.from("payment_provider_checkouts").update({ external_checkout_id: created.externalId, checkout_url: created.checkoutUrl }).eq("id", record.id);
    if (save.error) throw save.error;
    const status = await admin.from("orders").update({ status: "pending_payment" }).eq("id", order.id);
    if (status.error) throw status.error;
    return { orderId: order.id, checkoutUrl: created.checkoutUrl, reused: true };
  }

  const { data: rawOffer, error: offerError } = await admin.from("offers")
    .select("*, products(*)").eq("checkout_slug", input.offerSlug)
    .eq("status", "active").single();
  if (offerError || !rawOffer || !rawOffer.products || Array.isArray(rawOffer.products)) throw new HttpError(404, "Oferta ativa nao encontrada.");
  const offer = rawOffer as unknown as CommercialOffer & { products: CommercialProduct };
  const product = offer.products;
  if (product.status !== "active") throw new HttpError(409, "Produto indisponível para venda.");
  if (offer.billing_type === "recurring") return createRecurringCheckout(admin, input, offer, product);

  const { data: participants, error: participantError } = await admin.from("product_participants")
    .select("user_id, participation_bps, offer_id")
    .eq("product_id", product.id).eq("active", true)
    .or(`offer_id.is.null,offer_id.eq.${offer.id}`);
  if (participantError) throw participantError;

  let affiliate: { userId: string; rule: FeeRule; membershipId: string; linkId: string } | undefined;
  if (input.refCode && offer.affiliate_enabled) {
    const { data: link } = await admin.from("affiliate_links")
      .select("id, membership_id, affiliate_memberships!inner(user_id, status, affiliate_commission_bps_override, affiliate_programs!inner(product_id, active))")
      .eq("ref_code", input.refCode).eq("active", true).maybeSingle();
    const membership = link?.affiliate_memberships;
    if (link && membership && !Array.isArray(membership) && membership.status === "active" && membership.affiliate_programs?.product_id === product.id && membership.affiliate_programs.active) {
      const commissionBpsOverride = await resolveOfferCommissionOverride({
        admin,
        membershipId: link.membership_id,
        offerId: offer.id,
        legacyMembershipOverride: membership.affiliate_commission_bps_override,
      });
      affiliate = {
        userId: membership.user_id,
        membershipId: link.membership_id,
        linkId: link.id,
        rule: affiliateCommissionRule(offer, commissionBpsOverride),
      };
    }
  }

  const result = new FinancialDistributionService().calculate({
    grossAmountCents: Number(offer.price_cents),
    gatewayFeeCents: 0,
    settlementModel: product.settlement_model,
    producerId: product.producer_id,
    prosperityFee: rule(
      offer.prosperity_fee_type ?? product.prosperity_fee_type,
      offer.prosperity_fee_bps ?? product.prosperity_fee_bps,
      Number(offer.prosperity_fee_fixed_cents ?? product.prosperity_fee_fixed_cents),
    ),
    affiliate,
    coproducers: (participants ?? []).map((item) => ({ userId: item.user_id, basisPoints: item.participation_bps })),
  });

  const selectedConnection = await selectConnection(admin, product);
  const { data: customer, error: customerError } = await admin.from("customers").insert({
    email: input.customerEmail.toLowerCase(), name: input.customerName,
  }).select("id").single();
  if (customerError) throw customerError;

  const { data: order, error: orderError } = await admin.from("orders").insert({
    product_id: product.id, offer_id: offer.id, producer_id: product.producer_id,
    customer_id: customer.id, settlement_model: product.settlement_model,
    gross_amount_cents: offer.price_cents, currency: offer.currency,
    idempotency_key: input.idempotencyKey, status: "draft",
  }).select("id").single();
  if (orderError) throw orderError;

  if (affiliate && !result.affiliateSuppressedByCoproduction) {
    await admin.from("affiliate_attributions").insert({
      affiliate_link_id: affiliate.linkId, affiliate_membership_id: affiliate.membershipId,
      order_id: order.id, ref_code: input.refCode!, expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    });
  }

  const { data: snapshot, error: snapshotError } = await admin.from("financial_snapshots").insert({
    order_id: order.id, settlement_model: product.settlement_model, currency: offer.currency,
    gross_amount_cents: result.grossAmountCents, gateway_fee_amount_cents: result.gatewayFeeCents,
    prosperity_fee_amount_cents: result.prosperityFeeCents, affiliate_amount_cents: result.affiliateCents,
    coproducer_amount_cents: result.coproducerCents, producer_amount_cents: result.producerCents,
    prosperity_split_amount_cents: result.prosperitySplitCents,
    rules: { calculationVersion: 1, gatewayFeePendingReconciliation: true, affiliateSuppressedByCoproduction: result.affiliateSuppressedByCoproduction },
  }).select("id").single();
  if (snapshotError) throw snapshotError;

  const { error: allocationError } = await admin.from("financial_allocations").insert(
    result.allocations.map((allocation) => ({
      snapshot_id: snapshot.id, allocation_type: allocation.type, destination: allocation.destination,
      beneficiary_user_id: allocation.beneficiaryUserId, amount_cents: allocation.amountCents,
      currency: offer.currency, rule_snapshot: allocation.ruleSnapshot,
    })),
  );
  if (allocationError) throw allocationError;

  const paymentId = crypto.randomUUID();
  const externalReference = `prosperity:${paymentId}`;
  const { error: paymentError } = await admin.from("payments").insert({
    id: paymentId, order_id: order.id, provider_id: selectedConnection.provider_id,
    connection_id: selectedConnection.id, external_reference: externalReference,
    idempotency_key: `${input.idempotencyKey}:payment`, gross_amount_cents: offer.price_cents,
    currency: offer.currency,
  });
  if (paymentError) throw paymentError;

  const checkoutIdempotency = `${input.idempotencyKey}:checkout`;
  const { error: checkoutRecordError } = await admin.from("payment_provider_checkouts").insert({
    order_id: order.id, provider_id: selectedConnection.provider_id, connection_id: selectedConnection.id,
    idempotency_key: checkoutIdempotency,
  });
  if (checkoutRecordError) throw checkoutRecordError;

  const provider = getPaymentProvider("mercadopago", await getProviderAccessToken(selectedConnection.id));
  const appUrl = requireEnv(env.appUrl, "NEXT_PUBLIC_APP_URL");
  const checkout = await provider.createCheckout({
    externalReference, idempotencyKey: checkoutIdempotency, title: `${product.name} — ${offer.name}`,
    money: { amount: Number(offer.price_cents) / 100, currency: "BRL" },
    notificationUrl: `${appUrl}/api/webhooks/mercadopago?source_news=webhooks`,
    successUrl: `${appUrl}/checkout/sucesso?order=${order.id}`,
    failureUrl: `${appUrl}/checkout/falha?order=${order.id}`,
    pendingUrl: `${appUrl}/checkout/pendente?order=${order.id}`,
    marketplaceFeeAmount: product.settlement_model === "connected_account" ? result.prosperitySplitCents / 100 : undefined,
    maxInstallments: offer.payment_card_enabled ? Number(offer.max_installments) : 1,
    paymentMethods: paymentMethods(offer),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  const updates = await Promise.all([
    admin.from("payment_provider_checkouts").update({ external_checkout_id: checkout.externalId, checkout_url: checkout.checkoutUrl }).eq("order_id", order.id),
    admin.from("orders").update({ status: "pending_payment" }).eq("id", order.id),
  ]);
  for (const update of updates) if (update.error) throw update.error;
  return { orderId: order.id, checkoutUrl: checkout.checkoutUrl, reused: false };
}
