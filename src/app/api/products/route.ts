import { NextResponse } from "next/server";
import { asObject, jsonError, optionalString, requiredString } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/require-user";
import { isProductKind, isProductPaymentType, isRecurrenceFrequency, type RecurrenceFrequency } from "@/lib/domain/product-rules";
import { toSlug } from "@/lib/domain/slug";
import type { Database } from "@/lib/supabase/database.types";

type ProductInsert = Database["public"]["Tables"]["products"]["Insert"] & {
  payment_type: "one_time" | "recurring";
  product_type: "digital" | "physical";
  category: string | null;
  support_display_name: string | null;
  support_email: string | null;
  support_whatsapp: string | null;
  recurrence_frequency: RecurrenceFrequency | null;
  different_first_charge: boolean;
  first_charge_cents: number | null;
  recurring_price_cents: number | null;
  main_offer_price_cents: number | null;
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

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const { data, error } = await supabase.from("products").select("*").eq("producer_id", user.id).order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ products: data });
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
    try {
      category = nullableText(body, "category", 120);
      supportDisplayName = nullableText(body, "supportDisplayName", 180);
      supportEmail = nullableText(body, "supportEmail", 320);
      supportWhatsapp = nullableText(body, "supportWhatsapp", 32);
    } catch (error) {
      const field = error instanceof Error ? error.message.replace("INVALID:", "") : "dados";
      return NextResponse.json({ error: `Campo ${field} inválido.` }, { status: 400 });
    }
    if (supportEmail && !/^\S+@\S+\.\S+$/.test(supportEmail)) return NextResponse.json({ error: "E-mail do SAC inválido." }, { status: 400 });

    const paymentType = requestedPaymentType;
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
      recurrence_frequency: recurrenceFrequency,
      different_first_charge: differentFirstCharge,
      first_charge_cents: firstChargeCents,
      recurring_price_cents: recurringPriceCents,
      main_offer_price_cents: mainOfferPriceCents,
    };
    const { data, error } = await supabase.from("products").insert(insert).select().single();
    if (error) throw error;
    return NextResponse.json({ product: data }, { status: 201 });
  } catch (error) { return jsonError(error); }
}
