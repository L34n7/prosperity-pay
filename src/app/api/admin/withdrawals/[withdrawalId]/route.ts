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
    if (status === "paid" && !optionalString(body, "receiptReference", 255)) return NextResponse.json({ error: "Informe o comprovante ou referência do Pix antes de marcar como pago." }, { status: 400 });
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("transition_withdrawal", {
      target_withdrawal_id: withdrawalId,
      target_status: status,
      target_operator_id: user.id,
      target_receipt_reference: optionalString(body, "receiptReference", 255),
      target_note: optionalString(body, "note", 1000),
    });
    if (error) throw error;
    const audit = await admin.from("audit_events").insert({ actor_user_id: user.id, action: `withdrawal.${status}`, entity_type: "withdrawal", entity_id: withdrawalId, metadata: { receiptReference: optionalString(body, "receiptReference", 255) ?? null, note: optionalString(body, "note", 1000) ?? null } });
    if (audit.error) console.error("Falha ao registrar auditoria do saque", audit.error);
    return NextResponse.json({ withdrawal: data });
  } catch (error) { return jsonError(error); }
}
