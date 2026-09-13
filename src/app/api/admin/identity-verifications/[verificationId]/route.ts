import { NextResponse } from "next/server";
import { asObject, jsonError, optionalString, requiredString } from "@/lib/api/http";
import { requireFinanceAdmin } from "@/lib/auth/require-user";
import { createAdminClient } from "@/lib/supabase/admin";

type Context = { params: Promise<{ verificationId: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const { verificationId } = await context.params;
    const { user } = await requireFinanceAdmin();
    const body = asObject(await request.json());
    const status = requiredString(body, "status", 30);
    if (!["approved", "rejected", "resubmission_required"].includes(status)) {
      return NextResponse.json({ error: "Status de analise invalido." }, { status: 400 });
    }
    if (status === "approved" && !optionalString(body, "reviewNote", 1000)) return NextResponse.json({ error: "Registre a referência da verificação de identidade antes de aprovar." }, { status: 400 });
    const admin = createAdminClient();
    const { data, error } = await admin.from("identity_verifications").update({
      status: status as "approved" | "rejected" | "resubmission_required",
      reviewer_id: user.id,
      review_note: optionalString(body, "reviewNote", 1000),
      reviewed_at: new Date().toISOString(),
    }).eq("id", verificationId).eq("status", "under_review").select("id, status, reviewed_at").single();
    if (error) throw error;
    const audit = await admin.from("audit_events").insert({ actor_user_id: user.id, action: `identity_verification.${status}`, entity_type: "identity_verification", entity_id: verificationId, metadata: { reviewNote: optionalString(body, "reviewNote", 1000) ?? null } });
    if (audit.error) console.error("Falha ao registrar auditoria da identidade", audit.error);
    return NextResponse.json({ verification: data });
  } catch (error) { return jsonError(error); }
}
