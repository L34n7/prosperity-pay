import { NextResponse } from "next/server";
import { asObject, HttpError, jsonError, optionalString } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/require-user";
import type { Database } from "@/lib/supabase/database.current.types";

type Context = { params: Promise<{ productId: string; addonId: string }> };

function positiveCents(value: unknown) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new HttpError(400, "Valor do adicional inválido.");
  return amount;
}

function maxQuantity(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 10000) throw new HttpError(400, "Quantidade máxima inválida.");
  return parsed;
}

async function owned(supabase: Awaited<ReturnType<typeof requireUser>>["supabase"], productId: string) {
  const { data } = await supabase.rpc("owns_product", { target_product_id: productId });
  if (!data) throw new HttpError(404, "Produto não encontrado.");
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { productId, addonId } = await context.params;
    const { supabase } = await requireUser();
    await owned(supabase, productId);
    const body = asObject(await request.json());
    const update: Database["public"]["Tables"]["product_addons"]["Update"] = {};
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (name.length < 2 || name.length > 180) throw new HttpError(400, "Nome inválido.");
      update.name = name;
    }
    if (body.description !== undefined) update.description = optionalString(body, "description", 1000) ?? null;
    if (body.unitAmountCents !== undefined) update.unit_amount_cents = positiveCents(body.unitAmountCents);
    if (body.maxQuantity !== undefined) update.max_quantity = maxQuantity(body.maxQuantity);
    if (body.active !== undefined) update.active = body.active === true;
    const { data, error } = await supabase.from("product_addons").update(update)
      .eq("id", addonId).eq("product_id", productId).select().maybeSingle();
    if (error) throw error;
    if (!data) throw new HttpError(404, "Adicional não encontrado.");
    return NextResponse.json({ addon: data });
  } catch (error) { return jsonError(error); }
}

export async function DELETE(_: Request, context: Context) {
  try {
    const { productId, addonId } = await context.params;
    const { supabase } = await requireUser();
    await owned(supabase, productId);
    const { count, error: countError } = await supabase.from("subscription_items")
      .select("id", { count: "exact", head: true }).eq("addon_id", addonId);
    if (countError) throw countError;
    if ((count ?? 0) > 0) throw new HttpError(409, "Este adicional já possui histórico de assinatura. Desative-o em vez de excluir.");
    const { data, error } = await supabase.from("product_addons").delete()
      .eq("id", addonId).eq("product_id", productId).select("id").maybeSingle();
    if (error) throw error;
    if (!data) throw new HttpError(404, "Adicional não encontrado.");
    return NextResponse.json({ deleted: true });
  } catch (error) { return jsonError(error); }
}
