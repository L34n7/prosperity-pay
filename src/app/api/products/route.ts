import { NextResponse } from "next/server";
import { asObject, jsonError, optionalString, requiredString } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/require-user";
import { isProductCategory, isProductKind, isProductPaymentType, isRecurrenceFrequency, type RecurrenceFrequency } from "@/lib/domain/product-rules";
import { toSlug } from "@/lib/domain/slug";
import type { Database } from "@/lib/supabase/database.types";

type ProductInsert = Database["public"]["Tables"]["products"]["Insert"] & {
  payment_type: "one_time" | "recurring";
  billing_model: "prepaid" | "postpaid";
  product_type: "digital" | "physical";
  category: string | null;
  support_display_name: string | null;
  support_email: string | null;
  support_whatsapp: string | null;
  post_purchase_message: string | null;
  post_purchase_redirect_url: string | null;
  recurrence_frequency: RecurrenceFrequency | null;
  different_first_charge: boolean;
  first_charge_cents: number | null;
  recurring_price_cents: number | null;
  main_offer_price_cents: number | null;
  automatic_due_billing_enabled: boolean;
  partner_payment_emails_enabled: boolean;
};

type ProductStats = {
  completed_sales: number;
  total_sales_cents: number;
  affiliate_count: number;
  coproducer_count: number;
};

function positiveCents(value: unknown, field: string) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(`INVALID:${field}`);
  }
  return Number(value);
}

function nullableText(body: Record<string, unknown>, key: string, maxLength: number) {
  const value = body[key];
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > maxLength) throw new Error(`INVALID:${key}`);
  return value.trim();
}

function nullableHttpUrl(body: Record<string, unknown>, key: string) {
  const value = nullableText(body, key, 2048);
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
    return value;
  } catch {
    throw new Error(`INVALID:${key}`);
  }
}

function emptyStats(): ProductStats {
  return {
    completed_sales: 0,
    total_sales_cents: 0,
    affiliate_count: 0,
    coproducer_count: 0,
  };
}

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const { data, error } = await supabase.from("products").select("*").eq("producer_id", user.id).order("created_at", { ascending: false });
    if (error) throw error;

    const products = data ?? [];
    if (!products.length) return NextResponse.json({ products: [] });

    const productIds = products.map((product) => product.id);
    const [ordersResult, programsResult, participantsResult] = await Promise.all([
      supabase
        .from("orders")
        .select("product_id,gross_amount_cents")
        .eq("producer_id", user.id)
        .eq("status", "paid")
        .in("product_id", productIds),
      supabase.from("affiliate_programs").select("id,product_id").in("product_id", productIds),
      supabase.from("product_participants").select("product_id").eq("active", true).in("product_id", productIds),
    ]);

    if (ordersResult.error) throw ordersResult.error;
    if (programsResult.error) throw programsResult.error;
    if (participantsResult.error) throw participantsResult.error;

    const stats = new Map<string, ProductStats>(productIds.map((productId) => [productId, emptyStats()]));

    for (const order of ordersResult.data ?? []) {
      const productStats = stats.get(order.product_id);
      if (!productStats) continue;
      productStats.completed_sales += 1;
      productStats.total_sales_cents += Number(order.gross_amount_cents ?? 0);
    }

    for (const participant of participantsResult.data ?? []) {
      const productStats = stats.get(participant.product_id);
      if (productStats) productStats.coproducer_count += 1;
    }

    const programs = programsResult.data ?? [];
    const programToProduct = new Map(programs.map((program) => [program.id, program.product_id]));
    const programIds = programs.map((program) => program.id);

    if (programIds.length) {
      const membershipsResult = await supabase
        .from("affiliate_memberships")
        .select("program_id")
        .eq("status", "active")
        .in("program_id", programIds);

      if (membershipsResult.error) throw membershipsResult.error;

      for (const membership of membershipsResult.data ?? []) {
        const productId = programToProduct.get(membership.program_id);
        const productStats = productId ? stats.get(productId) : undefined;
        if (productStats) productStats.affiliate_count += 1;
      }
    }

    return NextResponse.json({
      products: products.map((product) => ({
        ...product,
        stats: stats.get(product.id) ?? emptyStats(),
      })),
    });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = asObject(await request.json());
    const name = requiredString(body, "name", 180);
    const description = optionalString(body, "description", 4000);
    const settlementModel = body.settlementModel;
    if (settlementModel !== "connected_account" && settlementModel !== "prosperity_balance") {
      return NextResponse.json({ error: "Modelo de recebimento inválido." }, { status: 400 });
    }
    const requestedPaymentType = body.paymentType;
    const productType = body.productType;
    if (!isProductPaymentType(requestedPaymentType)) return NextResponse.json({ error: "Tipo de pagamento inválido." }, { status: 400 });
    if (!isProductKind(productType)) return NextResponse.json({ error: "Tipo de produto inválido." }, { status: 400 });

    let category: string | null, supportDisplayName: string | null, supportEmail: string | null, supportWhatsapp: string | null;
    let postPurchaseMessage: string | null, postPurchaseRedirectUrl: string | null;
    try {
      category = nullableText(body, "category", 120);
      if (category && !isProductCategory(category)) throw new Error("INVALID:category");
      supportDisplayName = nullableText(body, "supportDisplayName", 180);
      supportEmail = nullableText(body, "supportEmail", 320);
      supportWhatsapp = nullableText(body, "supportWhatsapp", 32);
      postPurchaseMessage = nullableText(body, "postPurchaseMessage", 4000);
      postPurchaseRedirectUrl = nullableHttpUrl(body, "postPurchaseRedirectUrl");
    } catch (error) {
      const field = error instanceof Error ? error.message.replace("INVALID:", "") : "dados";
      return NextResponse.json({ error: `Campo ${field} inválido.` }, { status: 400 });
    }
    if (supportEmail && !/^\S+@\S+\.\S+$/.test(supportEmail)) return NextResponse.json({ error: "E-mail do SAC inválido." }, { status: 400 });

    const paymentType = requestedPaymentType as "one_time" | "recurring";
    const differentFirstCharge = paymentType === "recurring" && body.differentFirstCharge === true;
    let recurrenceFrequency: RecurrenceFrequency | null = null;
    let firstChargeCents: number | null = null;
    let recurringPriceCents: number | null = null;
    let mainOfferPriceCents: number | null = null;

    try {
      if (paymentType === "recurring") {
        if (!isRecurrenceFrequency(body.recurrenceFrequency)) return NextResponse.json({ error: "Frequência da recorrência inválida." }, { status: 400 });
        recurrenceFrequency = body.recurrenceFrequency;
        recurringPriceCents = positiveCents(body.recurringPriceCents, "recurringPriceCents");
        if (differentFirstCharge) firstChargeCents = positiveCents(body.firstChargeCents, "firstChargeCents");
      } else {
        mainOfferPriceCents = positiveCents(body.mainOfferPriceCents, "mainOfferPriceCents");
      }
    } catch (error) {
      const field = error instanceof Error ? error.message.replace("INVALID:", "") : "preço";
      return NextResponse.json({ error: `Campo ${field} inválido.` }, { status: 400 });
    }

    const slug = `${toSlug(name)}-${crypto.randomUUID().slice(0, 8)}`;
    const insert: ProductInsert = {
      producer_id: user.id,
      name,
      description,
      slug,
      settlement_model: settlementModel,
      payment_type: paymentType,
      product_type: productType,
      category,
      support_display_name: supportDisplayName,
      support_email: supportEmail,
      support_whatsapp: supportWhatsapp,
      post_purchase_message: postPurchaseMessage,
      post_purchase_redirect_url: postPurchaseRedirectUrl,
      recurrence_frequency: recurrenceFrequency,
      different_first_charge: differentFirstCharge,
      first_charge_cents: firstChargeCents,
      recurring_price_cents: recurringPriceCents,
      main_offer_price_cents: mainOfferPriceCents,
      automatic_due_billing_enabled:
        paymentType === "recurring" &&
        body.automaticDueBillingEnabled === true,
      partner_payment_emails_enabled: true,
      billing_model: "prepaid",
    };
    const { data, error } = await (supabase.from("products") as any).insert(insert).select().single();
    if (error) throw error;
    return NextResponse.json({ product: data }, { status: 201 });
  } catch (error) { return jsonError(error); }
}
