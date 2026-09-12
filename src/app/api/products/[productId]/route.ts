import { NextResponse } from "next/server";
import { asObject, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/require-user";
import type { Database } from "@/lib/supabase/database.types";

type Context = { params: Promise<{ productId: string }> };
type ProductUpdate = Database["public"]["Tables"]["products"]["Update"];

export async function PATCH(request: Request, context: Context) {
  try {
    const { productId } = await context.params;
    const { supabase } = await requireUser();
    const body = asObject(await request.json());
    const update: ProductUpdate = {};
    if (typeof body.name === "string") update.name = body.name.trim().slice(0, 180);
    if (typeof body.description === "string" || body.description === null) update.description = body.description;
    if (["draft", "active", "inactive", "archived"].includes(String(body.status))) update.status = body.status as ProductUpdate["status"];
    if (["connected_account", "prosperity_balance"].includes(String(body.settlementModel))) update.settlement_model = body.settlementModel as ProductUpdate["settlement_model"];
    const { data, error } = await supabase.from("products").update(update).eq("id", productId).select().single();
    if (error) throw error;
    return NextResponse.json({ product: data });
  } catch (error) { return jsonError(error); }
}
