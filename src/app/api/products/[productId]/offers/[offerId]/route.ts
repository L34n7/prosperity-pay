import { NextResponse } from "next/server";
import { asObject, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/require-user";
import type { Database } from "@/lib/supabase/database.types";

type Context = { params: Promise<{ productId: string; offerId: string }> };
type OfferUpdate = Database["public"]["Tables"]["offers"]["Update"];

export async function PATCH(request: Request, context: Context) {
  try {
    const { productId, offerId } = await context.params;
    const { supabase } = await requireUser();
    const body = asObject(await request.json());
    const update: OfferUpdate = {};
    if (typeof body.name === "string") update.name = body.name.trim().slice(0, 180);
    if (Number.isSafeInteger(body.priceCents) && Number(body.priceCents) > 0) update.price_cents = Number(body.priceCents);
    if (["draft", "active", "inactive", "archived"].includes(String(body.status))) update.status = body.status as OfferUpdate["status"];
    if (Number.isInteger(body.affiliateCommissionBps) && Number(body.affiliateCommissionBps) >= 0 && Number(body.affiliateCommissionBps) <= 10_000) {
      update.affiliate_commission_bps = Number(body.affiliateCommissionBps);
    }
    const { data, error } = await supabase.from("offers").update(update)
      .eq("id", offerId).eq("product_id", productId).select().single();
    if (error) throw error;
    return NextResponse.json({ offer: data });
  } catch (error) { return jsonError(error); }
}
