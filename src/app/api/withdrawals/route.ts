import { NextResponse } from "next/server";
import { asObject, jsonError, requiredInteger, requiredString } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/require-user";

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const { data, error } = await supabase.from("withdrawals").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ withdrawals: data });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    const { supabase } = await requireUser();
    const body = asObject(await request.json());
    const amountCents = requiredInteger(body, "amountCents", 1);
    const payoutAccountId = requiredString(body, "payoutAccountId", 36);
    const { data, error } = await supabase.rpc("request_withdrawal", {
      requested_amount_cents: amountCents,
      requested_payout_account_id: payoutAccountId,
    });
    if (error) throw error;
    return NextResponse.json({ withdrawal: data }, { status: 201 });
  } catch (error) { return jsonError(error); }
}
