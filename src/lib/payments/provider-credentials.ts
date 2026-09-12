import { decryptSecret } from "@/lib/security/secrets";
import { createAdminClient } from "@/lib/supabase/admin";

export async function getProviderAccessToken(connectionId: string) {
  const { data, error } = await createAdminClient().rpc("get_payment_provider_credential", {
    target_connection_id: connectionId,
  });
  if (error) throw error;
  const credential = data?.[0];
  if (!credential) throw new Error("Credencial ativa do provedor nao encontrada.");
  return decryptSecret(credential.encrypted_access_token);
}
