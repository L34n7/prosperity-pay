import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminView } from "@/components/admin-view";
export const dynamic="force-dynamic";
export default async function Page(){const {supabase}=await requireUser();const {data:authorized}=await supabase.rpc("is_finance_admin");if(!authorized)redirect("/dashboard");const admin=createAdminClient();const [identity,pix,withdrawals,payments,webhooks,connections,users,audit,platform]=await Promise.all([
 admin.from("identity_verifications").select("id,legal_name,status,tax_id_last4,submitted_at").order("submitted_at",{ascending:false}).limit(100),
 admin.from("payout_accounts").select("id,holder_name,status,key_type,key_last4,created_at").order("created_at",{ascending:false}).limit(100),
 admin.from("withdrawals").select("id,amount_cents,status,created_at,payout_key_last4").order("created_at",{ascending:false}).limit(100),
 admin.from("payments").select("id,status,gross_amount_cents,external_payment_id,created_at").order("created_at",{ascending:false}).limit(100),
 admin.from("webhook_events").select("id,status,created_at").order("created_at",{ascending:false}).limit(100),
 admin.from("payment_provider_connections").select("id,external_account_id,status,connected_at").order("connected_at",{ascending:false}).limit(100),
 admin.from("profiles").select("id,full_name,email,created_at").order("created_at",{ascending:false}).limit(100),
 admin.from("audit_events").select("id,action,created_at").order("created_at",{ascending:false}).limit(100),
 admin.from("payment_provider_connections").select("id,external_account_id").eq("connection_kind","prosperity_balance").eq("status","active").maybeSingle(),
 ]);const failed=[identity,pix,withdrawals,payments,webhooks,connections,users,audit,platform].find(r=>r.error);if(failed?.error)throw failed.error;return <AdminView identity={identity.data??[]} pix={pix.data??[]} withdrawals={withdrawals.data??[]} payments={payments.data??[]} webhooks={webhooks.data??[]} connections={connections.data??[]} users={users.data??[]} audit={audit.data??[]} platform={platform.data??null}/>}
