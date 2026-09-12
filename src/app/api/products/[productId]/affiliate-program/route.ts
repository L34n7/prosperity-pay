import { NextResponse } from "next/server";
import { asObject, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/require-user";
import { createAdminClient } from "@/lib/supabase/admin";

type Context = { params: Promise<{ productId: string }> };

export async function PUT(request: Request, context: Context) {
  try {
    const { productId } = await context.params;
    const { supabase } = await requireUser();
    const { data: owns } = await supabase.rpc("owns_product", { target_product_id: productId });
    if (!owns) return NextResponse.json({ error: "Produto nao encontrado." }, { status: 404 });
    const body = asObject(await request.json());
    const mode = body.mode;
    if (mode !== "public" && mode !== "approval" && mode !== "invite") {
      return NextResponse.json({ error: "Modo de afiliacao invalido." }, { status: 400 });
    }
    const cookieDays = Number(body.cookieDays ?? 30);
    if (!Number.isInteger(cookieDays) || cookieDays < 1 || cookieDays > 365) {
      return NextResponse.json({ error: "Validade da atribuicao invalida." }, { status: 400 });
    }
    const admin = createAdminClient();
    const { data, error } = await admin.from("affiliate_programs").upsert({
      product_id: productId, mode, active: Boolean(body.active), cookie_days: cookieDays,
      terms: typeof body.terms === "string" ? body.terms.slice(0, 10_000) : null,
    }, { onConflict: "product_id" }).select().single();
    if (error) throw error;
    return NextResponse.json({ program: data });
  } catch (error) { return jsonError(error); }
}
