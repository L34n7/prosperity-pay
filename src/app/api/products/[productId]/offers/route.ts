import { NextResponse } from "next/server";
import { asObject, jsonError, requiredString } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/require-user";
import { createCheckoutReference } from "@/lib/domain/offer-reference";
import { calculateMaxInstallments } from "@/lib/domain/offer-rules";
import { isRecurrenceFrequency, recurrenceToBilling, type RecurrenceFrequency } from "@/lib/domain/product-rules";
import type { Database } from "@/lib/supabase/database.types";
import { hasActivePlatformMercadoPagoConnection } from "@/lib/payments/platform-connection";

type Context = { params: Promise<{ productId: string }> };
type OfferInsert = Database["public"]["Tables"]["offers"]["Insert"] & {
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
  recurring_price_cents: number | null;
  main_offer_price_cents: number | null;
};

function positiveInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}

async function ensureCanActivate(
  product: ProductRow,
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  productId: string,
  affiliateEnabled: boolean,
  cardEnabled: boolean,
  billingType: "one_time" | "recurring",
) {
  if (product.status !== "active") return "Ative o produto antes da oferta.";
  if (billingType === "recurring" && product.settlement_model === "connected_account") {
    if (affiliateEnabled) return "Assinaturas com recebimento direto no Mercado Pago não suportam comissão automática de afiliado. Use o Saldo Prosperity para dividir recorrências.";
    const { count, error } = await supabase.from("product_participants").select("id", { count: "exact", head: true })
      .eq("product_id", productId).eq("active", true).is("offer_id", null);
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

export async function GET(_: Request, context: Context) {
  try {
    const { productId } = await context.params;
    const { supabase } = await requireUser();
    const { data, error } = await supabase.from("offers").select("*").eq("product_id", productId).order("created_at");
    if (error) throw error;
    return NextResponse.json({ offers: data });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    const { productId } = await context.params;
    const { supabase } = await requireUser();
    const body = asObject(await request.json());
    if (body.affiliateHoldDays !== undefined) return NextResponse.json({ error: "A liberação da comissão é definida pela Prosperity Pay." }, { status: 400 });
    if (body.prosperityFeeBps !== undefined) return NextResponse.json({ error: "A taxa da Prosperity só pode ser alterada pela administração." }, { status: 403 });

    const productResult = await supabase.from("products").select("*").eq("id", productId).single();
    if (productResult.error || !productResult.data) throw productResult.error ?? new Error("Produto não encontrado.");
    const product = productResult.data as ProductRow;
    const name = requiredString(body, "name", 180);
    const requestedBillingType = body.billingType;
    if (requestedBillingType !== undefined && requestedBillingType !== "one_time" && requestedBillingType !== "recurring") {
      return NextResponse.json({ error: "Tipo da oferta inválido." }, { status: 400 });
    }
    const billingType: "one_time" | "recurring" = product.payment_type === "recurring"
      ? (requestedBillingType === "one_time" ? "one_time" : "recurring")
      : "one_time";
    const defaultPrice = billingType === "recurring" ? product.recurring_price_cents : product.main_offer_price_cents;
    const priceCents = body.priceCents === undefined ? positiveInteger(defaultPrice) : positiveInteger(body.priceCents);
    if (!priceCents) return NextResponse.json({ error: "Preço inválido." }, { status: 400 });

    const cardEnabled = body.paymentCardEnabled !== false;
    const pixEnabled = body.paymentPixEnabled !== false;
    if (!cardEnabled && !pixEnabled) return NextResponse.json({ error: "Selecione Cartão e/ou PIX." }, { status: 400 });
    const primary = body.primaryPaymentMethod === "pix" ? "pix" : "card";
    if ((primary === "card" && !cardEnabled) || (primary === "pix" && !pixEnabled)) return NextResponse.json({ error: "O método principal precisa estar habilitado." }, { status: 400 });

    const allowedMax = calculateMaxInstallments(priceCents);
    const requestedInstallments = body.maxInstallments === undefined ? allowedMax : positiveInteger(body.maxInstallments);
    if (!requestedInstallments || requestedInstallments > allowedMax) return NextResponse.json({ error: `Escolha entre 1x e ${allowedMax}x.` }, { status: 400 });
    const maxInstallments = billingType === "recurring" ? 1 : cardEnabled ? requestedInstallments : 1;

    let billingInterval: string | null = null;
    let billingIntervalCount: number | null = null;
    let firstChargeCents: number | null = null;
    if (billingType === "recurring") {
      if (!isRecurrenceFrequency(product.recurrence_frequency)) return NextResponse.json({ error: "Configure a frequência de recorrência do produto." }, { status: 409 });
      const billing = recurrenceToBilling(product.recurrence_frequency);
      billingInterval = billing.interval;
      billingIntervalCount = billing.count;
      if (product.different_first_charge) {
        firstChargeCents = body.firstChargeCents === undefined ? positiveInteger(product.first_charge_cents) : positiveInteger(body.firstChargeCents);
        if (!firstChargeCents) return NextResponse.json({ error: "Valor da primeira cobrança inválido." }, { status: 400 });
      }
    }

    const affiliateEnabled = body.affiliateEnabled === true;
    const affiliateCommissionBps = affiliateEnabled ? Number(body.affiliateCommissionBps ?? 0) : 0;
    if (!Number.isInteger(affiliateCommissionBps) || affiliateCommissionBps < 0 || affiliateCommissionBps > 10_000) return NextResponse.json({ error: "Comissão de afiliado inválida." }, { status: 400 });
    const active = body.active === true;
    if (active) {
      const activationError = await ensureCanActivate(product, supabase, productId, affiliateEnabled, cardEnabled, billingType);
      if (activationError) return NextResponse.json({ error: activationError }, { status: 409 });
    }

    const insert: OfferInsert = {
      product_id: productId,
      name,
      checkout_slug: createCheckoutReference(),
      price_cents: priceCents,
      billing_type: billingType,
      billing_interval: billingInterval,
      billing_interval_count: billingIntervalCount,
      max_installments: maxInstallments,
      payment_card_enabled: cardEnabled,
      payment_pix_enabled: pixEnabled,
      primary_payment_method: primary,
      first_charge_cents: firstChargeCents,
      affiliate_enabled: affiliateEnabled,
      affiliate_commission_bps: affiliateCommissionBps,
      status: active ? "active" : "draft",
    };
    const { data, error } = await supabase.from("offers").insert(insert).select().single();
    if (error) throw error;
    return NextResponse.json({ offer: data }, { status: 201 });
  } catch (error) { return jsonError(error); }
}
