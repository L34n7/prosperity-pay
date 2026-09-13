import { decryptSecret } from "@/lib/security/secrets";
import { createAdminClient } from "@/lib/supabase/admin";

export async function getProviderAccessToken(connectionId: string) {
  const { data: connection, error: connectionError } = await createAdminClient().from("payment_provider_connections")
    .select("status, token_expires_at").eq("id", connectionId).single();
  if (connectionError || !connection || connection.status !== "active") throw new Error("Conexão de pagamento indisponível.");
  if (connection.token_expires_at && new Date(connection.token_expires_at).getTime() <= Date.now()) {
    throw new Error("Conexão Mercado Pago expirada. Reconecte a conta para continuar vendendo.");
  }
  const { data, error } = await createAdminClient().rpc("get_payment_provider_credential", {
    target_connection_id: connectionId,
  });
  if (error) throw error;
  const credential = data?.[0];
  if (!credential) throw new Error("Credencial ativa do provedor nao encontrada.");
  return decryptSecret(credential.encrypted_access_token);
}
