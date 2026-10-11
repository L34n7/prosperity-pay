import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  sendFinancialReviewDecisionEmail,
  sendFinancialReviewRequestedEmail,
  type FinancialReviewKind,
} from "@/lib/email/resend-auth";

function appBaseUrl() {
  return (env.appUrl || "https://www.prosperitypay.com.br").replace(/\/$/, "");
}

async function getProfile(userId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("profiles")
    .select("id,full_name,email")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function notifyFinanceAdmins(params: {
  requesterUserId: string;
  kind: FinancialReviewKind;
  details: Array<{ label: string; value: string }>;
}) {
  try {
    const admin = createAdminClient();
    const requester = await getProfile(params.requesterUserId);

    const { data: roles, error: rolesError } = await admin
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin");

    if (rolesError) throw rolesError;

    const adminIds = [...new Set((roles ?? []).map((row) => row.user_id))];
    if (!adminIds.length) return;

    const { data: profiles, error: profilesError } = await admin
      .from("profiles")
      .select("id,full_name,email")
      .in("id", adminIds);

    if (profilesError) throw profilesError;

    const recipients = (profiles ?? []).filter((profile) => profile.email);
    if (!recipients.length) return;

    const link = `${appBaseUrl()}/admin`;
    const results = await Promise.allSettled(
      recipients.map((profile) =>
        sendFinancialReviewRequestedEmail({
          to: profile.email!,
          name: profile.full_name || "Administrador",
          kind: params.kind,
          requesterName: requester?.full_name || "Usuário",
          requesterEmail: requester?.email || "Não informado",
          details: params.details,
          link,
        }),
      ),
    );

    for (const result of results) {
      if (result.status === "rejected") {
        console.error("Falha ao notificar admin sobre análise financeira", result.reason);
      }
    }
  } catch (error) {
    console.error("Falha ao preparar notificação administrativa financeira", error);
  }
}

export async function notifyUserFinancialReviewDecision(params: {
  userId: string;
  kind: FinancialReviewKind;
  statusLabel: string;
  observation?: string | null;
  details?: Array<{ label: string; value: string }>;
}) {
  try {
    const profile = await getProfile(params.userId);
    if (!profile?.email) return;

    const link =
      params.kind === "withdrawal"
        ? `${appBaseUrl()}/saques`
        : `${appBaseUrl()}/conta`;

    await sendFinancialReviewDecisionEmail({
      to: profile.email,
      name: profile.full_name || "cliente",
      kind: params.kind,
      statusLabel: params.statusLabel,
      observation: params.observation,
      details: params.details,
      link,
    });
  } catch (error) {
    console.error("Falha ao notificar usuário sobre análise financeira", error);
  }
}
