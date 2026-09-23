import { NextResponse } from "next/server";
import { asObject, HttpError, jsonError, optionalString, requiredString } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/require-user";

type Context = { params: Promise<{ productId: string }> };

function codeValue(value: string) {
  const code = value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  if (!/^[a-z0-9][a-z0-9_]{1,79}$/.test(code)) throw new HttpError(400, "Código do adicional inválido.");
  return code;
}

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

async function ensureRecurringProduct(supabase: Awaited<ReturnType<typeof requireUser>>["supabase"], productId: string) {
  const { data, error } = await supabase.from("products").select("id,payment_type").eq("id", productId).single();
  if (error || !data) throw new HttpError(404, "Produto não encontrado.");
  if (data.payment_type !== "recurring") throw new HttpError(409, "Adicionais recorrentes estão disponíveis somente em produtos de assinatura.");
}

export async function GET(_: Request, context: Context) {
  try {
    const { productId } = await context.params;
    const { supabase } = await requireUser();
    const { data: owns } = await supabase.rpc("owns_product", { target_product_id: productId });
    if (!owns) throw new HttpError(404, "Produto não encontrado.");
    const { data, error } = await supabase.from("product_addons").select("*").eq("product_id", productId).order("created_at");
    if (error) throw error;
    return NextResponse.json({ addons: data ?? [] });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    const { productId } = await context.params;
    const { supabase } = await requireUser();
    const { data: owns } = await supabase.rpc("owns_product", { target_product_id: productId });
    if (!owns) throw new HttpError(404, "Produto não encontrado.");
    await ensureRecurringProduct(supabase, productId);

    const body = asObject(await request.json());
    const name = requiredString(body, "name", 180);
    const code = codeValue(typeof body.code === "string" && body.code.trim() ? body.code : name);
    const { data, error } = await supabase.from("product_addons").insert({
      product_id: productId,
      code,
      name,
      description: optionalString(body, "description", 1000) ?? null,
      unit_amount_cents: positiveCents(body.unitAmountCents),
      max_quantity: maxQuantity(body.maxQuantity),
      active: body.active !== false,
    }).select().single();
    if (error?.code === "23505") throw new HttpError(409, "Já existe um adicional com este código.");
    if (error || !data) throw error ?? new Error("Falha ao criar adicional.");
    return NextResponse.json({ addon: data }, { status: 201 });
  } catch (error) { return jsonError(error); }
}
