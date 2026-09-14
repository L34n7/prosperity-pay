import { redirect } from "next/navigation";
import { PlatformSettings } from "@/components/platform-settings";
import { requirePlatformAdmin } from "@/lib/auth/require-user";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function Page() {
  try {
    await requirePlatformAdmin();
  } catch {
    redirect("/dashboard");
  }

  const { data: connection, error } = await createAdminClient()
    .from("payment_provider_connections")
    .select("id,external_account_id,status,live_mode,connected_at,updated_at")
    .eq("connection_kind", "prosperity_balance")
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;

  return <PlatformSettings connection={connection} tokenConfigured={Boolean(env.mercadoPagoAccessToken)} />;
}
