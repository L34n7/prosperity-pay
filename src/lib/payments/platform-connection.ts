import { createAdminClient } from "@/lib/supabase/admin";

export async function hasActivePlatformMercadoPagoConnection() {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("payment_provider_connections")
    .select("id,payment_providers!inner(code)")
    .eq("connection_kind", "prosperity_balance")
    .is("owner_user_id", null)
    .eq("status", "active")
    .eq("payment_providers.code", "mercadopago")
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}
