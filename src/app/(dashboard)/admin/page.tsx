import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/security/secrets";
import { AdminView } from "@/components/admin-view";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { supabase } = await requireUser();
  const { data: authorized } = await supabase.rpc("is_finance_admin");
  if (!authorized) redirect("/dashboard");

  const admin = createAdminClient();
  const [identity, pix, withdrawals, payments, webhooks, connections, users, audit] =
    await Promise.all([
      admin
        .from("identity_verifications")
        .select(
          "id,user_id,person_type,legal_name,tax_id_last4,tax_id_encrypted,birth_date,business_name,status,review_note,submitted_at,reviewed_at,document_storage_path,document_original_name,document_mime_type",
        )
        .order("submitted_at", { ascending: false })
        .limit(100),
      admin
        .from("payout_accounts")
        .select(
          "id,user_id,holder_name,holder_tax_id_last4,status,key_type,key_last4,encrypted_key,is_primary,created_at,updated_at",
        )
        .neq("status", "disabled")
        .order("created_at", { ascending: false })
        .limit(100),
      admin
        .from("withdrawals")
        .select("id,amount_cents,status,created_at,payout_key_last4")
        .order("created_at", { ascending: false })
        .limit(100),
      admin
        .from("payments")
        .select("id,status,gross_amount_cents,external_payment_id,created_at")
        .order("created_at", { ascending: false })
        .limit(100),
      admin
        .from("webhook_events")
        .select("id,status,created_at")
        .order("created_at", { ascending: false })
        .limit(100),
      admin
        .from("payment_provider_connections")
        .select("id,external_account_id,status,connected_at")
        .order("connected_at", { ascending: false })
        .limit(100),
      admin
        .from("profiles")
        .select("id,full_name,email,created_at")
        .order("created_at", { ascending: false })
        .limit(100),
      admin
        .from("audit_events")
        .select("id,action,created_at")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

  const failed = [
    identity,
    pix,
    withdrawals,
    payments,
    webhooks,
    connections,
    users,
    audit,
  ].find((result) => result.error);
  if (failed?.error) throw failed.error;

  const identityRows = identity.data ?? [];
  const pixRows = pix.data ?? [];
  const relatedUserIds = [
    ...new Set([
      ...identityRows.map((row) => row.user_id),
      ...pixRows.map((row) => row.user_id),
    ]),
  ];

  const profiles = relatedUserIds.length
    ? await admin
        .from("profiles")
        .select("id,email,full_name")
        .in("id", relatedUserIds)
    : { data: [], error: null };

  if (profiles.error) throw profiles.error;

  const profilesById = new Map(
    (profiles.data ?? []).map((profile) => [profile.id, profile]),
  );

  const enrichedIdentity = await Promise.all(
    identityRows.map(async (row) => {
      let documentUrl: string | null = null;

      if (row.document_storage_path) {
        const { data } = await admin.storage
          .from("identity-documents")
          .createSignedUrl(row.document_storage_path, 10 * 60);
        documentUrl = data?.signedUrl ?? null;
      }

      const profile = profilesById.get(row.user_id);

      let taxIdValue: string | null = null;
      if (row.tax_id_encrypted) {
        try {
          taxIdValue = decryptSecret(row.tax_id_encrypted);
        } catch {
          taxIdValue = null;
        }
      }

      return {
        id: row.id,
        user_id: row.user_id,
        person_type: row.person_type,
        legal_name: row.legal_name,
        tax_id_last4: row.tax_id_last4,
        tax_id_value: taxIdValue,
        birth_date: row.birth_date,
        business_name: row.business_name,
        status: row.status,
        review_note: row.review_note,
        submitted_at: row.submitted_at,
        reviewed_at: row.reviewed_at,
        document_original_name: row.document_original_name,
        document_mime_type: row.document_mime_type,
        email: profile?.email ?? null,
        user_full_name: profile?.full_name ?? null,
        document_url: documentUrl,
      };
    }),
  );

  const enrichedPix = pixRows.map((row) => {
    const profile = profilesById.get(row.user_id);
    let keyValue: string | null = null;

    try {
      keyValue = decryptSecret(row.encrypted_key);
    } catch {
      keyValue = null;
    }

    return {
      id: row.id,
      user_id: row.user_id,
      holder_name: row.holder_name,
      holder_tax_id_last4: row.holder_tax_id_last4,
      status: row.status,
      key_type: row.key_type,
      key_last4: row.key_last4,
      key_value: keyValue,
      is_primary: row.is_primary,
      created_at: row.created_at,
      updated_at: row.updated_at,
      email: profile?.email ?? null,
      user_full_name: profile?.full_name ?? null,
    };
  });

  return (
    <AdminView
      identity={enrichedIdentity}
      pix={enrichedPix}
      withdrawals={withdrawals.data ?? []}
      payments={payments.data ?? []}
      webhooks={webhooks.data ?? []}
      connections={connections.data ?? []}
      users={users.data ?? []}
      audit={audit.data ?? []}
    />
  );
}
