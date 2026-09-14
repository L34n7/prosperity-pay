import { HttpError } from "@/lib/api/http";
import { env, requireEnv } from "@/lib/env";
import { FinancialDistributionService, type FeeRule } from "@/lib/financial/financial-distribution-service";
import { getPaymentProvider } from "@/lib/payments";
import { getProviderAccessToken } from "@/lib/payments/provider-credentials";
import { createAdminClient } from "@/lib/supabase/admin";

type CheckoutRequest = {
  offerSlug: string;
  customerName?: string;
  customerEmail: string;
  refCode?: string;
  idempotencyKey: string;
};

function rule(type: "percentage" | "fixed" | "hybrid", basisPoints: number, fixedCents: number): FeeRule {
  return { type, basisPoints, fixedCents };
}

export async function createCheckout(input: CheckoutRequest) {
  const admin = createAdminClient();
  const { data: existing } = await admin.from("orders")
    .select("id, payment_provider_checkouts(checkout_url, external_checkout_id)")
    .eq("idempotency_key", input.idempotencyKey).maybeSingle();
  if (existing) {
    const checkout = Array.isArray(existing.payment_provider_checkouts)
      ? existing.payment_provider_checkouts[0]
      : existing.payment_provider_checkouts;
    if (checkout?.checkout_url) return { orderId: existing.id, checkoutUrl: checkout.checkout_url, reused: true };
    const [orderResult, paymentResult, checkoutResult] = await Promise.all([
      admin.from("orders").select("id,gross_amount_cents,settlement_model,products(name),offers!orders_offer_id_fkey(name,max_installments),customers(email),financial_snapshots(prosperity_split_amount_cents)").eq("id", existing.id).single(),
      admin.from("payments").select("id,connection_id,external_reference").eq("order_id", existing.id).single(),
      admin.from("payment_provider_checkouts").select("id,idempotency_key,connection_id").eq("order_id", existing.id).single(),
    ]);
    const order = orderResult.data;
    const storedPayment = paymentResult.data;
    const record = checkoutResult.data;
    if (!order || !storedPayment || !record) throw new HttpError(409, "O pedido não foi concluído. Inicie outra tentativa de pagamento.");
    const provider = getPaymentProvider("mercadopago", await getProviderAccessToken(record.connection_id));
    const appUrl = requireEnv(env.appUrl, "NEXT_PUBLIC_APP_URL");
    const created = await provider.createCheckout({
      externalReference: storedPayment.external_reference, idempotencyKey: record.idempotency_key,
      title: `${order.products.name} — ${order.offers.name}`,
      money: { amount: Number(order.gross_amount_cents) / 100, currency: "BRL" },
      payerEmail: order.customers.email,
      notificationUrl: `${appUrl}/api/webhooks/mercadopago?source_news=webhooks`,
      successUrl: `${appUrl}/checkout/sucesso?order=${order.id}`,
      failureUrl: `${appUrl}/checkout/falha?order=${order.id}`,
      pendingUrl: `${appUrl}/checkout/pendente?order=${order.id}`,
      marketplaceFeeAmount: order.settlement_model === "connected_account" ? Number(order.financial_snapshots?.prosperity_split_amount_cents ?? 0) / 100 : undefined,
      maxInstallments: Number(order.offers.max_installments),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    const save = await admin.from("payment_provider_checkouts").update({ external_checkout_id: created.externalId, checkout_url: created.checkoutUrl }).eq("id", record.id);
    if (save.error) throw save.error;
    const status = await admin.from("orders").update({ status: "pending_payment" }).eq("id", order.id);
    if (status.error) throw status.error;
    return { orderId: order.id, checkoutUrl: created.checkoutUrl, reused: true };
  }

  const { data: offer, error: offerError } = await admin.from("offers")
    .select("*, products(*)").eq("checkout_slug", input.offerSlug)
    .eq("status", "active").single();
  if (offerError || !offer || !offer.products || Array.isArray(offer.products)) {
    throw new HttpError(404, "Oferta ativa nao encontrada.");
  }
  const product = offer.products;
  if (product.status !== "active") throw new HttpError(409, "Produto indisponível para venda.");
  if (offer.billing_type === "recurring") throw new HttpError(409, "Cobrança recorrente ainda não está habilitada no processador.");

  const { data: participants, error: participantError } = await admin.from("product_participants")
    .select("user_id, participation_bps, offer_id")
    .eq("product_id", product.id).eq("active", true)
    .or(`offer_id.is.null,offer_id.eq.${offer.id}`);
  if (participantError) throw participantError;

  let affiliate: { userId: string; rule: FeeRule; membershipId: string; linkId: string } | undefined;
  if (input.refCode) {
    const { data: link } = await admin.from("affiliate_links")
      .select("id, membership_id, affiliate_memberships!inner(user_id, status, affiliate_programs!inner(product_id, active))")
      .eq("ref_code", input.refCode).eq("active", true).maybeSingle();
    const membership = link?.affiliate_memberships;
    if (link && membership && !Array.isArray(membership) && membership.status === "active" && membership.affiliate_programs?.product_id === product.id && membership.affiliate_programs.active) {
      affiliate = {
        userId: membership.user_id,
        membershipId: link.membership_id,
        linkId: link.id,
        rule: rule(offer.affiliate_commission_type, offer.affiliate_commission_bps, Number(offer.affiliate_commission_fixed_cents)),
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

  let selectedConnection: { id: string; provider_id: string } | null = null;
  if (product.settlement_model === "connected_account") {
    const query = await admin.from("payment_provider_connections").select("id, provider_id")
      .eq("connection_kind", "connected_account").eq("owner_user_id", product.producer_id)
      .eq("status", "active").single();
    selectedConnection = query.data;
    if (query.error) throw new HttpError(409, "O produtor precisa conectar o Mercado Pago antes de vender.");
  } else {
    const query = await admin.from("payment_provider_connections").select("id, provider_id")
      .eq("connection_kind", "prosperity_balance").is("owner_user_id", null)
      .eq("status", "active").single();
    selectedConnection = query.data;
    if (query.error) throw new HttpError(503, "Conta Mercado Pago da Prosperity ainda nao configurada.");
  }
  if (!selectedConnection) throw new HttpError(503, "Conexao de pagamento indisponivel.");

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
    payerEmail: input.customerEmail,
    notificationUrl: `${appUrl}/api/webhooks/mercadopago?source_news=webhooks`,
    successUrl: `${appUrl}/checkout/sucesso?order=${order.id}`,
    failureUrl: `${appUrl}/checkout/falha?order=${order.id}`,
    pendingUrl: `${appUrl}/checkout/pendente?order=${order.id}`,
    marketplaceFeeAmount: product.settlement_model === "connected_account" ? result.prosperitySplitCents / 100 : undefined,
    maxInstallments: Number(offer.max_installments),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  const updates = await Promise.all([
    admin.from("payment_provider_checkouts").update({ external_checkout_id: checkout.externalId, checkout_url: checkout.checkoutUrl }).eq("order_id", order.id),
    admin.from("orders").update({ status: "pending_payment" }).eq("id", order.id),
  ]);
  for (const update of updates) if (update.error) throw update.error;
  return { orderId: order.id, checkoutUrl: checkout.checkoutUrl, reused: false };
}
