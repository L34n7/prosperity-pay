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
    const { data, error } = await createAdminClient().from("identity_verifications").update({
      status: status as "approved" | "rejected" | "resubmission_required",
      reviewer_id: user.id,
      review_note: optionalString(body, "reviewNote", 1000),
      reviewed_at: new Date().toISOString(),
    }).eq("id", verificationId).select("id, status, reviewed_at").single();
    if (error) throw error;
    return NextResponse.json({ verification: data });
  } catch (error) { return jsonError(error); }
}
