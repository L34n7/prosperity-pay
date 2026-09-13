import { NextResponse } from "next/server";
import { asObject, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/require-user";
import type { Database } from "@/lib/supabase/database.types";
import { createAdminClient } from "@/lib/supabase/admin";

type Context = { params: Promise<{ productId: string }> };
type ProductUpdate = Database["public"]["Tables"]["products"]["Update"];

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
    const update: ProductUpdate = {};
    if (typeof body.name === "string") update.name = body.name.trim().slice(0, 180);
    if (typeof body.description === "string" || body.description === null) update.description = body.description;
    if (["draft", "active", "inactive", "archived"].includes(String(body.status))) update.status = body.status as ProductUpdate["status"];
    // O modelo de recebimento é fixado na criação: alterar depois afetaria os pedidos existentes.
    if (body.settlementModel !== undefined) return NextResponse.json({ error: "O modelo de recebimento não pode ser alterado." }, { status: 400 });
    if (update.status === "active") {
      const { data: product } = await supabase.from("products").select("producer_id, settlement_model").eq("id", productId).single();
      if (!product) return NextResponse.json({ error: "Produto não encontrado." }, { status: 404 });
      const { data: ready } = await supabase.from("payment_provider_connections").select("id").eq("owner_user_id", product.producer_id).eq("status", "active").maybeSingle();
      if (product.settlement_model === "connected_account" && !ready) return NextResponse.json({ error: "Conecte o Mercado Pago antes de ativar o produto." }, { status: 409 });
      if (product.settlement_model === "prosperity_balance") {
        const { data: platform } = await createAdminClient().from("payment_provider_connections").select("id").eq("connection_kind", "prosperity_balance").eq("status", "active").maybeSingle();
        if (!platform) return NextResponse.json({ error: "A conta central Prosperity ainda não foi configurada." }, { status: 409 });
      }
    }
    const { data, error } = await supabase.from("products").update(update).eq("id", productId).select().single();
    if (error) throw error;
    return NextResponse.json({ product: data });
  } catch (error) { return jsonError(error); }
}
