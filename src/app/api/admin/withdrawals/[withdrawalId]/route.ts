import { NextResponse } from "next/server";
import { asObject, jsonError, optionalString, requiredString } from "@/lib/api/http";
import { requireFinanceAdmin } from "@/lib/auth/require-user";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";

type Status = Database["public"]["Enums"]["withdrawal_status"];
const ALLOWED = new Set<Status>(["processing", "paid", "rejected", "cancelled", "failed"]);
type Context = { params: Promise<{ withdrawalId: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const { user } = await requireFinanceAdmin();
    const { withdrawalId } = await context.params;
    const body = asObject(await request.json());
    const status = requiredString(body, "status", 20) as Status;
    if (!ALLOWED.has(status)) return NextResponse.json({ error: "Status invalido." }, { status: 400 });
    const { data, error } = await createAdminClient().rpc("transition_withdrawal", {
      target_withdrawal_id: withdrawalId,
      target_status: status,
      target_operator_id: user.id,
      target_receipt_reference: optionalString(body, "receiptReference", 255),
      target_note: optionalString(body, "note", 1000),
    });
    if (error) throw error;
    return NextResponse.json({ withdrawal: data });
  } catch (error) { return jsonError(error); }
}
