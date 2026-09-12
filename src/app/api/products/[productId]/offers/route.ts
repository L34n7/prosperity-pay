import { NextResponse } from "next/server";
import { asObject, jsonError, requiredInteger, requiredString } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/require-user";
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
    const name = requiredString(body, "name", 180);
    const priceCents = requiredInteger(body, "priceCents", 1);
    const billingType = body.billingType === "recurring" ? "recurring" : "one_time";
    const maxInstallments = body.maxInstallments == null ? 1 : requiredInteger(body, "maxInstallments", 1);
    if (maxInstallments > 24) return NextResponse.json({ error: "Parcelamento maximo de 24 vezes." }, { status: 400 });

    const recurring = billingType === "recurring";
    const { data, error } = await supabase.from("offers").insert({
      product_id: productId,
      name,
      checkout_slug: `${toSlug(name)}-${crypto.randomUUID().slice(0, 8)}`,
      price_cents: priceCents,
      billing_type: billingType,
      billing_interval: recurring ? "month" : null,
      billing_interval_count: recurring ? 1 : null,
      max_installments: maxInstallments,
    }).select().single();
    if (error) throw error;
    return NextResponse.json({ offer: data }, { status: 201 });
  } catch (error) { return jsonError(error); }
}
