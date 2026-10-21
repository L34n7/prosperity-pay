import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;
type ReversalStatus = "refunded" | "charged_back";

export async function reversePaymentFinancials(input: {
  admin: AdminClient;
  paymentId: string;
  status: ReversalStatus;
  externalPaymentId?: string | null;
}) {
  const { admin, paymentId, status, externalPaymentId } = input;
  const { data: entries, error } = await admin
    .from("ledger_entries")
    .select("id,account_id,order_id,payment_id,settlement_model,amount_cents,currency")
    .eq("payment_id", paymentId)
    .eq("status", "posted")
    .gt("amount_cents", 0);

  if (error) throw error;

  const entryType = status === "refunded" ? "refund" : "chargeback";
  const now = new Date().toISOString();

  if (entries?.length) {
    const byAccount = new Map<
      string,
      { amount: number; ids: string[]; entry: (typeof entries)[number] }
    >();

    for (const entry of entries) {
      const group = byAccount.get(entry.account_id) ?? {
        amount: 0,
        ids: [],
        entry,
      };
      group.amount += Number(entry.amount_cents);
      group.ids.push(entry.id);
      byAccount.set(entry.account_id, group);
    }

    const reversal = await admin.from("ledger_entries").upsert(
      [...byAccount.values()].map(({ amount, ids, entry }) => ({
        account_id: entry.account_id,
        order_id: entry.order_id,
        payment_id: entry.payment_id,
        settlement_model: entry.settlement_model,
        entry_type: entryType,
        amount_cents: -amount,
        currency: entry.currency,
        available_at: now,
        source_type: entryType,
        source_id: paymentId,
        reference: `${entryType}:${externalPaymentId ?? paymentId}`,
        metadata: { reversesEntryIds: ids },
      })),
      {
        onConflict: "account_id,source_type,source_id,entry_type",
        ignoreDuplicates: true,
      },
    );

    if (reversal.error) throw reversal.error;
  }

  const commissionReversal = await admin
    .from("commissions")
    .update({ status: "reversed", reversed_at: now })
    .eq("payment_id", paymentId)
    .in("status", ["pending", "available", "paid"]);

  if (commissionReversal.error) throw commissionReversal.error;
}
