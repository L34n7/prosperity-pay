import { NextResponse } from "next/server";
import { asObject, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/require-user";
import { calculateMaxInstallments } from "@/lib/domain/offer-rules";
import { isRecurrenceFrequency, recurrenceToBilling, type RecurrenceFrequency } from "@/lib/domain/product-rules";
import type { Database } from "@/lib/supabase/database.types";
import { hasActivePlatformMercadoPagoConnection } from "@/lib/payments/platform-connection";

type Context = { params: Promise<{ productId: string; offerId: string }> };
type OfferUpdate = Database["public"]["Tables"]["offers"]["Update"] & {
  payment_card_enabled?: boolean;
  payment_pix_enabled?: boolean;
  primary_payment_method?: "card" | "pix";
  first_charge_cents?: number | null;
  affiliate_enabled?: boolean;
};
type OfferRow = Database["public"]["Tables"]["offers"]["Row"] & {
  payment_card_enabled: boolean;
  payment_pix_enabled: boolean;
  primary_payment_method: "card" | "pix";
  first_charge_cents: number | null;
  affiliate_enabled: boolean;
};
type ProductRow = Database["public"]["Tables"]["products"]["Row"] & {
  payment_type: "one_time" | "recurring";
  recurrence_frequency: RecurrenceFrequency | null;
  different_first_charge: boolean;
  first_charge_cents: number | null;
};

function positiveInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}

async function activationError(
  product: ProductRow,
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  productId: string,
  offerId: string,
  affiliateEnabled: boolean,
  cardEnabled: boolean,
  billingType: "one_time" | "recurring",
) {
  if (product.status !== "active") return "Ative o produto antes da oferta.";
  if (billingType === "recurring" && product.settlement_model === "connected_account") {
    if (affiliateEnabled) return "Assinaturas com recebimento direto no Mercado Pago não suportam comissão automática de afiliado. Use o Saldo Prosperity para dividir recorrências.";
    const { count, error } = await supabase.from("product_participants").select("id", { count: "exact", head: true })
      .eq("product_id", productId).eq("active", true).or(`offer_id.is.null,offer_id.eq.${offerId}`);
    if (error) throw error;
    if ((count ?? 0) > 0) return "Assinaturas com recebimento direto no Mercado Pago não suportam divisão automática com coprodutores. Use o Saldo Prosperity para dividir recorrências.";
  }
  if (product.settlement_model === "connected_account") {
    const { data } = await supabase.from("payment_provider_connections").select("id").eq("owner_user_id", product.producer_id).eq("status", "active").maybeSingle();
    return data ? null : "Conecte o Mercado Pago antes de ativar a oferta.";
  }
  return (await hasActivePlatformMercadoPagoConnection())
    ? null
    : "A conta central Prosperity ainda não foi configurada.";
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { productId, offerId } = await context.params;
    const { supabase } = await requireUser();
    const body = asObject(await request.json());
    if (body.affiliateHoldDays !== undefined) return NextResponse.json({ error: "A liberação da comissão é definida pela Prosperity Pay." }, { status: 400 });
    if (body.prosperityFeeBps !== undefined) return NextResponse.json({ error: "A taxa da Prosperity só pode ser alterada pela administração." }, { status: 403 });

    const [offerResult, productResult] = await Promise.all([
      supabase.from("offers").select("*").eq("id", offerId).eq("product_id", productId).single(),
      supabase.from("products").select("*").eq("id", productId).single(),
    ]);
    if (offerResult.error || !offerResult.data) throw offerResult.error ?? new Error("Oferta não encontrada.");
    if (productResult.error || !productResult.data) throw productResult.error ?? new Error("Produto não encontrado.");
    const offer = offerResult.data as OfferRow;
    const product = productResult.data as ProductRow;

    const requestedBillingType = body.billingType === undefined ? offer.billing_type : body.billingType;
    if (requestedBillingType !== "one_time" && requestedBillingType !== "recurring") {
      return NextResponse.json({ error: "Tipo da oferta inválido." }, { status: 400 });
    }
    const billingType: "one_time" | "recurring" = product.payment_type === "recurring"
      ? requestedBillingType
      : "one_time";
    if (billingType !== offer.billing_type) {
      const [{ count: orderCount, error: orderHistoryError }, { count: subscriptionCount, error: subscriptionHistoryError }] = await Promise.all([
        supabase.from("orders").select("id", { count: "exact", head: true }).eq("offer_id", offerId),
        supabase.from("subscriptions").select("id", { count: "exact", head: true }).eq("offer_id", offerId),
      ]);
      if (orderHistoryError) throw orderHistoryError;
      if (subscriptionHistoryError) throw subscriptionHistoryError;
      if ((orderCount ?? 0) > 0 || (subscriptionCount ?? 0) > 0) {
        return NextResponse.json({ error: "O tipo desta oferta não pode ser alterado porque já existe histórico financeiro." }, { status: 409 });
      }
    }

    const update: OfferUpdate = {};
    if (typeof body.name === "string") {
      const name = body.name.trim();
      if (name.length < 2 || name.length > 180) return NextResponse.json({ error: "Nome inválido." }, { status: 400 });
      update.name = name;
    }

    const priceCents = body.priceCents === undefined ? Number(offer.price_cents) : positiveInteger(body.priceCents);
    if (!priceCents) return NextResponse.json({ error: "Preço inválido." }, { status: 400 });
    update.price_cents = priceCents;

    const cardEnabled = body.paymentCardEnabled === undefined ? offer.payment_card_enabled : body.paymentCardEnabled === true;
    const pixEnabled = body.paymentPixEnabled === undefined ? offer.payment_pix_enabled : body.paymentPixEnabled === true;
    if (!cardEnabled && !pixEnabled) return NextResponse.json({ error: "Selecione Cartão e/ou PIX." }, { status: 400 });
    const primary = body.primaryPaymentMethod === undefined
      ? offer.primary_payment_method
      : body.primaryPaymentMethod === "pix" ? "pix" : "card";
    if ((primary === "card" && !cardEnabled) || (primary === "pix" && !pixEnabled)) return NextResponse.json({ error: "O método principal precisa estar habilitado." }, { status: 400 });
    update.payment_card_enabled = cardEnabled;
    update.payment_pix_enabled = pixEnabled;
    update.primary_payment_method = primary;

    const allowedMax = calculateMaxInstallments(priceCents);
    const requestedInstallments = body.maxInstallments === undefined ? Math.min(offer.max_installments, allowedMax) : positiveInteger(body.maxInstallments);
    if (!requestedInstallments || requestedInstallments > allowedMax) return NextResponse.json({ error: `Escolha entre 1x e ${allowedMax}x.` }, { status: 400 });
    update.max_installments = billingType === "recurring" ? 1 : cardEnabled ? requestedInstallments : 1;

    if (billingType === "recurring") {
      if (!isRecurrenceFrequency(product.recurrence_frequency)) return NextResponse.json({ error: "Configure a frequência de recorrência do produto." }, { status: 409 });
      const billing = recurrenceToBilling(product.recurrence_frequency);
      update.billing_type = "recurring";
      update.billing_interval = billing.interval;
      update.billing_interval_count = billing.count;
      if (product.different_first_charge) {
        const firstChargeCents = body.firstChargeCents === undefined
          ? positiveInteger(offer.first_charge_cents ?? product.first_charge_cents)
          : positiveInteger(body.firstChargeCents);
        if (!firstChargeCents) return NextResponse.json({ error: "Valor da primeira cobrança inválido." }, { status: 400 });
        update.first_charge_cents = firstChargeCents;
      } else update.first_charge_cents = null;
    } else {
      update.billing_type = "one_time";
      update.billing_interval = null;
      update.billing_interval_count = null;
      update.first_charge_cents = null;
    }

    const affiliateEnabled = body.affiliateEnabled === undefined ? offer.affiliate_enabled : body.affiliateEnabled === true;
    update.affiliate_enabled = affiliateEnabled;
    if (body.affiliateCommissionBps !== undefined) {
      const commission = Number(body.affiliateCommissionBps);
      if (!Number.isInteger(commission) || commission < 0 || commission > 10_000) return NextResponse.json({ error: "Comissão de afiliado inválida." }, { status: 400 });
      update.affiliate_commission_bps = commission;
    }

    if (body.active !== undefined) {
      const active = body.active === true;
      if (active) {
        const problem = await activationError(product, supabase, productId, offerId, affiliateEnabled, cardEnabled, billingType);
        if (problem) return NextResponse.json({ error: problem }, { status: 409 });
      }
      update.status = active ? "active" : "draft";
    }

    const { data, error } = await supabase.from("offers").update(update).eq("id", offerId).eq("product_id", productId).select().single();
    if (error) throw error;
    return NextResponse.json({ offer: data });
  } catch (error) { return jsonError(error); }
}

export async function DELETE(_: Request, context: Context) {
  try {
    const { productId, offerId } = await context.params;
    const { supabase } = await requireUser();
    const [{ count: orderCount, error: orderError }, { count: subscriptionCount, error: subscriptionError }] = await Promise.all([
      supabase.from("orders").select("id", { count: "exact", head: true }).eq("offer_id", offerId).eq("product_id", productId),
      supabase.from("subscriptions").select("id", { count: "exact", head: true }).eq("offer_id", offerId),
    ]);
    if (orderError) throw orderError;
    if (subscriptionError) throw subscriptionError;
    if ((orderCount ?? 0) > 0 || (subscriptionCount ?? 0) > 0) {
      return NextResponse.json({ error: "Esta oferta possui histórico financeiro e não pode ser excluída. Desative-a para preservar os registros." }, { status: 409 });
    }
    const { data, error } = await supabase.from("offers").delete().eq("id", offerId).eq("product_id", productId).select("id").maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Oferta não encontrada." }, { status: 404 });
    return NextResponse.json({ deleted: true });
  } catch (error) { return jsonError(error); }
}
