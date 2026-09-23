import { NextResponse } from "next/server";
import { asObject, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/require-user";
import { isProductCategory, isProductKind, isProductPaymentType, isRecurrenceFrequency, recurrenceToBilling, type RecurrenceFrequency } from "@/lib/domain/product-rules";
import type { Database } from "@/lib/supabase/database.types";
import { PRODUCT_IMAGE_BUCKET } from "@/lib/product-images";
import { hasActivePlatformMercadoPagoConnection } from "@/lib/payments/platform-connection";

type Context = { params: Promise<{ productId: string }> };
type ProductUpdate = Database["public"]["Tables"]["products"]["Update"] & {
  payment_type?: "one_time" | "recurring";
  billing_model?: "prepaid" | "postpaid";
  product_type?: "digital" | "physical";
  category?: string | null;
  support_display_name?: string | null;
  support_email?: string | null;
  support_whatsapp?: string | null;
  post_purchase_message?: string | null;
  post_purchase_redirect_url?: string | null;
  affiliate_funnel_base_url?: string | null;
  recurrence_frequency?: RecurrenceFrequency | null;
  different_first_charge?: boolean;
  first_charge_cents?: number | null;
  recurring_price_cents?: number | null;
  main_offer_price_cents?: number | null;
};
type OfferSync = Database["public"]["Tables"]["offers"]["Update"] & { first_charge_cents?: number | null };
type ProductRow = Database["public"]["Tables"]["products"]["Row"] & Required<Pick<ProductUpdate,
  "payment_type" | "product_type" | "different_first_charge"
>> & Pick<ProductUpdate,
  "category" | "support_display_name" | "support_email" | "support_whatsapp" | "post_purchase_message" | "post_purchase_redirect_url" | "affiliate_funnel_base_url" | "recurrence_frequency" | "first_charge_cents" | "recurring_price_cents" | "main_offer_price_cents"
>;

function nullableText(value: unknown, maxLength: number, field: string) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > maxLength) throw new Error(`INVALID:${field}`);
  return value.trim();
}

function nullableHttpUrl(value: unknown, field: string) {
  const normalized = nullableText(value, 2048, field);
  if (!normalized) return null;
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
    return normalized;
  } catch {
    throw new Error(`INVALID:${field}`);
  }
}

function nullableAffiliateFunnelBaseUrl(value: unknown) {
  const normalized = nullableHttpUrl(value, "affiliateFunnelBaseUrl");
  if (!normalized) return null;
  if (!/[?&]ref=$/.test(normalized)) {
    throw new Error("INVALID:affiliateFunnelBaseUrl");
  }
  return normalized;
}

function positiveCents(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error(`INVALID:${field}`);
  return Number(value);
}

export async function GET(_: Request, context: Context) {
  try {
    const { productId } = await context.params;
    const { supabase } = await requireUser();
    const { data, error } = await supabase.from("products").select("*").eq("id", productId).single();
    if (error) throw error;
    return NextResponse.json({ product: data });
  } catch (error) { return jsonError(error); }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { productId } = await context.params;
    const { supabase } = await requireUser();
    const body = asObject(await request.json());
    if (body.settlementModel !== undefined) return NextResponse.json({ error: "O modelo de recebimento não pode ser alterado." }, { status: 400 });

    const currentResult = await supabase.from("products").select("*").eq("id", productId).single();
    if (currentResult.error || !currentResult.data) throw currentResult.error ?? new Error("Produto não encontrado.");
    const current = currentResult.data as ProductRow;

    const requestedPaymentType = body.paymentType === undefined ? current.payment_type : body.paymentType;
    if (!isProductPaymentType(requestedPaymentType)) return NextResponse.json({ error: "Tipo de pagamento inválido." }, { status: 400 });
    if (requestedPaymentType !== current.payment_type) {
      const { count, error: historyError } = await supabase.from("orders").select("id", { count: "exact", head: true }).eq("product_id", productId);
      if (historyError) throw historyError;
      if ((count ?? 0) > 0) return NextResponse.json({ error: "O tipo de pagamento não pode ser alterado após existir histórico financeiro." }, { status: 409 });
    }
    const paymentType = requestedPaymentType;
    const productType = body.productType === undefined ? current.product_type : body.productType;
    if (!isProductKind(productType)) return NextResponse.json({ error: "Tipo de produto inválido." }, { status: 400 });

    const update: ProductUpdate = {};
    if (typeof body.name === "string") {
      const name = body.name.trim();
      if (name.length < 2 || name.length > 180) return NextResponse.json({ error: "Nome inválido." }, { status: 400 });
      update.name = name;
    }
    if (typeof body.description === "string" || body.description === null) update.description = body.description;
    if (["draft", "active", "inactive", "archived"].includes(String(body.status))) update.status = body.status as ProductUpdate["status"];

    try {
      update.payment_type = paymentType;
      update.billing_model = "prepaid";
      update.product_type = productType;
      update.category = body.category === undefined ? current.category : nullableText(body.category, 120, "category");
      if (update.category && !isProductCategory(update.category)) throw new Error("INVALID:category");
      update.support_display_name = body.supportDisplayName === undefined ? current.support_display_name : nullableText(body.supportDisplayName, 180, "supportDisplayName");
      update.support_email = body.supportEmail === undefined ? current.support_email : nullableText(body.supportEmail, 320, "supportEmail");
      update.support_whatsapp = body.supportWhatsapp === undefined ? current.support_whatsapp : nullableText(body.supportWhatsapp, 32, "supportWhatsapp");
      update.post_purchase_message = body.postPurchaseMessage === undefined ? current.post_purchase_message : nullableText(body.postPurchaseMessage, 4000, "postPurchaseMessage");
      update.post_purchase_redirect_url = body.postPurchaseRedirectUrl === undefined ? current.post_purchase_redirect_url : nullableHttpUrl(body.postPurchaseRedirectUrl, "postPurchaseRedirectUrl");
      update.affiliate_funnel_base_url = body.affiliateFunnelBaseUrl === undefined ? current.affiliate_funnel_base_url : nullableAffiliateFunnelBaseUrl(body.affiliateFunnelBaseUrl);
      if (update.support_email && !/^\S+@\S+\.\S+$/.test(update.support_email)) return NextResponse.json({ error: "E-mail do SAC inválido." }, { status: 400 });

      if (paymentType === "recurring") {
        const frequency = body.recurrenceFrequency === undefined ? current.recurrence_frequency : body.recurrenceFrequency;
        if (!isRecurrenceFrequency(frequency)) return NextResponse.json({ error: "Frequência da recorrência inválida." }, { status: 400 });
        update.recurrence_frequency = frequency;
        update.recurring_price_cents = body.recurringPriceCents === undefined
          ? positiveCents(current.recurring_price_cents, "recurringPriceCents")
          : positiveCents(body.recurringPriceCents, "recurringPriceCents");
        update.main_offer_price_cents = null;
        const different = body.differentFirstCharge === undefined ? current.different_first_charge : body.differentFirstCharge === true;
        update.different_first_charge = different;
        update.first_charge_cents = different
          ? (body.firstChargeCents === undefined ? positiveCents(current.first_charge_cents, "firstChargeCents") : positiveCents(body.firstChargeCents, "firstChargeCents"))
          : null;
      } else {
        update.recurrence_frequency = null;
        update.recurring_price_cents = null;
        update.different_first_charge = false;
        update.first_charge_cents = null;
        update.main_offer_price_cents = body.mainOfferPriceCents === undefined
          ? positiveCents(current.main_offer_price_cents, "mainOfferPriceCents")
          : positiveCents(body.mainOfferPriceCents, "mainOfferPriceCents");
      }
    } catch (error) {
      const field = error instanceof Error ? error.message.replace("INVALID:", "") : "dados";
      const message = field === "affiliateFunnelBaseUrl"
        ? "A URL principal de divulgação deve ser http(s) e terminar em ?ref= ou &ref=."
        : `Campo ${field} inválido.`;
      return NextResponse.json({ error: message }, { status: 400 });
    }

    if (update.status === "active") {
      if (current.settlement_model === "connected_account") {
        const { data: ready } = await supabase.from("payment_provider_connections").select("id").eq("owner_user_id", current.producer_id).eq("status", "active").maybeSingle();
        if (!ready) return NextResponse.json({ error: "Conecte o Mercado Pago antes de ativar o produto." }, { status: 409 });
      } else {
        const platformReady = await hasActivePlatformMercadoPagoConnection();
        if (!platformReady) return NextResponse.json({ error: "A conta central Prosperity ainda não foi configurada." }, { status: 409 });
      }
    }

    const { data, error } = await supabase.from("products").update(update).eq("id", productId).select().single();
    if (error) throw error;

    const billing = paymentType === "recurring" ? recurrenceToBilling(update.recurrence_frequency as RecurrenceFrequency) : null;
    const offerSync: OfferSync = {
      billing_type: paymentType,
      billing_interval: billing?.interval ?? null,
      billing_interval_count: billing?.count ?? null,
    };
    if (paymentType === "one_time" || !update.different_first_charge) offerSync.first_charge_cents = null;
    else if (current.payment_type !== "recurring" || current.first_charge_cents !== update.first_charge_cents || !current.different_first_charge) {
      offerSync.first_charge_cents = update.first_charge_cents;
    }
    let syncQuery = supabase.from("offers").update(offerSync).eq("product_id", productId);
    if (paymentType === "recurring") syncQuery = syncQuery.eq("billing_type", "recurring");
    const syncResult = await syncQuery;
    if (syncResult.error) throw syncResult.error;

    return NextResponse.json({ product: data });
  } catch (error) { return jsonError(error); }
}


export async function DELETE(_: Request, context: Context) {
  try {
    const { productId } = await context.params;
    const { user, supabase } = await requireUser();

    const { data: product, error: productError } = await supabase.from("products")
      .select("id,name,image_path")
      .eq("id", productId)
      .eq("producer_id", user.id)
      .maybeSingle();
    if (productError) throw productError;
    if (!product) return NextResponse.json({ error: "Produto não encontrado." }, { status: 404 });

    const { count: orderCount, error: orderError } = await supabase.from("orders")
      .select("id", { count: "exact", head: true })
      .eq("product_id", productId);
    if (orderError) throw orderError;
    if ((orderCount ?? 0) > 0) {
      return NextResponse.json({
        error: "Este produto possui histórico financeiro e não pode ser excluído. Arquive-o para preservar pagamentos e relatórios.",
      }, { status: 409 });
    }

    const { data: deleted, error: deleteError } = await supabase.from("products")
      .delete()
      .eq("id", productId)
      .eq("producer_id", user.id)
      .select("id")
      .maybeSingle();
    if (deleteError) throw deleteError;
    if (!deleted) return NextResponse.json({ error: "Produto não encontrado." }, { status: 404 });

    if (product.image_path) {
      const { error: storageError } = await supabase.storage.from(PRODUCT_IMAGE_BUCKET).remove([product.image_path]);
      if (storageError) console.error("Falha ao remover imagem do produto excluído", storageError);
    }

    return NextResponse.json({ deleted: true });
  } catch (error) {
    return jsonError(error);
  }
}
