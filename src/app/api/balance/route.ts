import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/require-user";

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const { data, error } = await supabase.from("user_balance_summary").select("*").eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    return NextResponse.json({ balance: data ?? {
      user_id: user.id, currency: "BRL", pending_cents: 0, available_cents: 0,
      withdrawing_cents: 0, total_received_cents: 0,
    } });
  } catch (error) { return jsonError(error); }
}
