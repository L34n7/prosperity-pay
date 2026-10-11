import { NextResponse } from "next/server";
import { asObject, jsonError, optionalString, requiredString } from "@/lib/api/http";
import { requireFinanceAdmin } from "@/lib/auth/require-user";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { notifyUserFinancialReviewDecision } from "@/lib/email/financial-review";

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
    const note = optionalString(body, "note", 1000);
    if (status === "paid" && !optionalString(body, "receiptReference", 255)) {
      return NextResponse.json(
        { error: "Informe o comprovante ou referência do Pix antes de marcar como pago." },
        { status: 400 },
      );
    }
    if (["rejected", "failed", "cancelled"].includes(status) && !note) {
      return NextResponse.json(
        { error: "Informe o motivo antes de concluir esta decisão." },
        { status: 400 },
      );
    }
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("transition_withdrawal", {
      target_withdrawal_id: withdrawalId,
      target_status: status,
      target_operator_id: user.id,
      target_receipt_reference: optionalString(body, "receiptReference", 255),
      target_note: note,
    });
    if (error) throw error;
    const audit = await admin.from("audit_events").insert({ actor_user_id: user.id, action: `withdrawal.${status}`, entity_type: "withdrawal", entity_id: withdrawalId, metadata: { receiptReference: optionalString(body, "receiptReference", 255) ?? null, note: note ?? null } });
    if (audit.error) console.error("Falha ao registrar auditoria do saque", audit.error);

    const { data: withdrawalRow, error: withdrawalError } = await admin
      .from("withdrawals")
      .select("user_id,amount_cents,payout_key_type,payout_key_last4,receipt_reference,note")
      .eq("id", withdrawalId)
      .single();

    if (withdrawalError) {
      console.error("Falha ao carregar saque para notificação", withdrawalError);
    } else {
      const statusLabel =
        status === "processing"
          ? "Em processamento"
          : status === "paid"
            ? "Pago"
            : status === "rejected"
              ? "Rejeitado"
              : status === "failed"
                ? "Falhou"
                : "Cancelado";

      await notifyUserFinancialReviewDecision({
        userId: withdrawalRow.user_id,
        kind: "withdrawal",
        statusLabel,
        observation: withdrawalRow.note,
        details: [
          {
            label: "Valor",
            value: new Intl.NumberFormat("pt-BR", {
              style: "currency",
              currency: "BRL",
            }).format(Number(withdrawalRow.amount_cents || 0) / 100),
          },
          {
            label: "Destino Pix",
            value: `${String(withdrawalRow.payout_key_type).toUpperCase()} · ••••${withdrawalRow.payout_key_last4}`,
          },
          ...(withdrawalRow.receipt_reference
            ? [
                {
                  label: "Comprovante / referência",
                  value: withdrawalRow.receipt_reference,
                },
              ]
            : []),
        ],
      });
    }

    return NextResponse.json({ withdrawal: data });
  } catch (error) { return jsonError(error); }
}
