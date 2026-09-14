import { NextResponse } from "next/server";
import { asObject, jsonError, requiredInteger, requiredString } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/require-user";
import { calculateMaxInstallments } from "@/lib/domain/offer-rules";
import { toSlug } from "@/lib/domain/slug";

type Context = { params: Promise<{ productId: string }> };

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

    if (body.maxInstallments !== undefined) {
      return NextResponse.json({ error: "Parcelamento é calculado automaticamente pela Prosperity Pay." }, { status: 400 });
    }
    if (body.affiliateHoldDays !== undefined) {
      return NextResponse.json({ error: "A liberação da comissão é definida pela Prosperity Pay." }, { status: 400 });
    }
    if (body.prosperityFeeBps !== undefined) {
      return NextResponse.json({ error: "A taxa da Prosperity só pode ser alterada pela administração." }, { status: 403 });
    }

    const name = requiredString(body, "name", 180);
    const priceCents = requiredInteger(body, "priceCents", 1);
    const billingType = body.billingType === "recurring" ? "recurring" : "one_time";
    if (billingType === "recurring") return NextResponse.json({ error: "Cobrança recorrente exige integração de assinaturas e ainda não está disponível." }, { status: 409 });
    const maxInstallments = calculateMaxInstallments(priceCents);

    const { data, error } = await supabase.from("offers").insert({
      product_id: productId,
      name,
      checkout_slug: `${toSlug(name)}-${crypto.randomUUID().slice(0, 8)}`,
      price_cents: priceCents,
      billing_type: billingType,
      billing_interval: null,
      billing_interval_count: null,
      max_installments: maxInstallments,
    }).select().single();
    if (error) throw error;
    return NextResponse.json({ offer: data }, { status: 201 });
  } catch (error) { return jsonError(error); }
}
