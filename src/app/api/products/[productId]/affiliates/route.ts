import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/require-user";

export async function GET(_: Request, { params }: { params: Promise<{ productId: string }> }) {
  try {
    const { productId } = await params;
    const { supabase } = await requireUser();
    const { data: owns } = await supabase.rpc("owns_product", { target_product_id: productId });
    if (!owns) return NextResponse.json({ error: "Produto não encontrado." }, { status: 404 });

    const { data: program, error } = await supabase.from("affiliate_programs")
      .select("id, mode, active, cookie_days")
      .eq("product_id", productId)
      .maybeSingle();
    if (error) throw error;

    const result = program
      ? await supabase.from("affiliate_memberships")
        .select("id, code, status, created_at, profiles!affiliate_memberships_user_id_fkey(full_name,email)")
        .eq("program_id", program.id)
        .order("created_at", { ascending: false })
      : { data: [], error: null };
    if (result.error) throw result.error;

    return NextResponse.json({ program, memberships: result.data ?? [] });
  } catch (error) {
    return jsonError(error);
  }
}
