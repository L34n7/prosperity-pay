import { NextResponse } from "next/server";
import { asObject, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/require-user";
import { calculateMaxInstallments } from "@/lib/domain/offer-rules";
import type { Database } from "@/lib/supabase/database.types";
import { createAdminClient } from "@/lib/supabase/admin";

type Context = { params: Promise<{ productId: string; offerId: string }> };
type OfferUpdate = Database["public"]["Tables"]["offers"]["Update"];

export async function PATCH(request: Request, context: Context) {
  try {
    const { productId, offerId } = await context.params;
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

    const update: OfferUpdate = {};
    if (typeof body.name === "string") update.name = body.name.trim().slice(0, 180);
    if (body.priceCents !== undefined) {
      if (!Number.isSafeInteger(body.priceCents) || Number(body.priceCents) <= 0) {
        return NextResponse.json({ error: "Preço inválido." }, { status: 400 });
      }
      const priceCents = Number(body.priceCents);
      update.price_cents = priceCents;
      update.max_installments = calculateMaxInstallments(priceCents);
    }
    if (["draft", "active", "inactive", "archived"].includes(String(body.status))) update.status = body.status as OfferUpdate["status"];
    if (update.status === "active") {
      const { data: currentOffer } = await supabase.from("offers").select("billing_type").eq("id", offerId).eq("product_id", productId).single();
      if (currentOffer?.billing_type === "recurring") return NextResponse.json({ error: "Cobrança recorrente ainda não está disponível." }, { status: 409 });
      const { data: product } = await supabase.from("products").select("producer_id, settlement_model, status").eq("id", productId).single();
      if (!product || product.status !== "active") return NextResponse.json({ error: "Ative o produto antes da oferta." }, { status: 409 });
      if (product.settlement_model === "connected_account") {
        const { data: connection } = await supabase.from("payment_provider_connections").select("id").eq("owner_user_id", product.producer_id).eq("status", "active").maybeSingle();
        if (!connection) return NextResponse.json({ error: "Conecte o Mercado Pago antes de ativar a oferta." }, { status: 409 });
      } else {
        const { data: platform } = await createAdminClient().from("payment_provider_connections").select("id").eq("connection_kind", "prosperity_balance").eq("status", "active").maybeSingle();
        if (!platform) return NextResponse.json({ error: "A conta central Prosperity ainda não foi configurada." }, { status: 409 });
      }
    }
    if (Number.isInteger(body.affiliateCommissionBps) && Number(body.affiliateCommissionBps) >= 0 && Number(body.affiliateCommissionBps) <= 10_000) {
      update.affiliate_commission_bps = Number(body.affiliateCommissionBps);
    }
    const { data, error } = await supabase.from("offers").update(update)
      .eq("id", offerId).eq("product_id", productId).select().single();
    if (error) throw error;
    return NextResponse.json({ offer: data });
  } catch (error) { return jsonError(error); }
}
