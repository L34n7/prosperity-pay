import { NextResponse } from "next/server";
import { asObject, jsonError, requiredString } from "@/lib/api/http";
import { requireFinanceAdmin } from "@/lib/auth/require-user";
import { createAdminClient } from "@/lib/supabase/admin";

type Context = { params: Promise<{ accountId: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const { user } = await requireFinanceAdmin();
    const { accountId } = await context.params;
    const status = requiredString(asObject(await request.json()), "status", 20);
    if (status !== "verified" && status !== "rejected" && status !== "disabled") {
      return NextResponse.json({ error: "Status invalido." }, { status: 400 });
    }
    const admin = createAdminClient();
    const { data, error } = await admin.from("payout_accounts")
      .update({ status }).eq("id", accountId).eq("status", "pending")
      .select("id, key_type, key_last4, status, is_primary").single();
    if (error) throw error;
    const audit = await admin.from("audit_events").insert({ actor_user_id: user.id, action: `payout_account.${status}`, entity_type: "payout_account", entity_id: accountId });
    if (audit.error) console.error("Falha ao registrar auditoria da chave Pix", audit.error);
    return NextResponse.json({ payoutAccount: data });
  } catch (error) { return jsonError(error); }
}
