import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
export async function GET(_: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  const { data } = await createAdminClient().from("orders").select("status").eq("id", orderId).maybeSingle();
  return data ? NextResponse.json({ status: data.status }, { headers: { "Cache-Control": "no-store" } }) : NextResponse.json({ error: "Pedido não encontrado." }, { status: 404 });
}
