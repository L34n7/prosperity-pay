import Link from "next/link";
import { CrmProsperityIntegration } from "@/components/integrations/crm-prosperity-integration";
import { PageHeader } from "@/components/ui/page-header";
import { ensureInitialPlatformAdmin } from "@/lib/auth/require-user";
import { env } from "@/lib/env";
import { formatDate } from "@/lib/operational";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function Page() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: connection, error } = await supabase
    .from("payment_provider_connections")
    .select("external_account_id,live_mode,status,connected_at,token_expires_at")
    .eq("owner_user_id", user!.id)
    .order("connected_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const effectiveStatus = connection?.token_expires_at && new Date(connection.token_expires_at) <= new Date()
    ? "expirado"
    : connection?.status;

  const isPlatformAdmin = user ? await ensureInitialPlatformAdmin(user.id) : false;
  let crmIntegration: any = null;
  let activeRouteCount = 0;
  let lastDelivery: any = null;

  if (isPlatformAdmin) {
    const admin = createAdminClient() as any;
    const [integrationResult, routeResult, deliveryResult] = await Promise.all([
      admin.from("platform_integrations")
        .select("id,name,webhook_url,status,secret_last_four,last_tested_at,last_test_status,last_test_http_status,last_test_message,disconnected_at,created_at,updated_at")
        .eq("integration_key", "crm_prosperity")
        .maybeSingle(),
      admin.from("integration_webhook_routes")
        .select("id", { count: "exact", head: true })
        .eq("integration", "crm_prosperity")
        .eq("active", true),
      admin.from("integration_webhook_deliveries")
        .select("status,event_type,response_status,last_error,last_attempt_at,created_at")
        .eq("integration", "crm_prosperity")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (!integrationResult.error && integrationResult.data) {
      const row = integrationResult.data;
      crmIntegration = {
        id: row.id,
        name: row.name,
        webhookUrl: row.webhook_url,
        status: row.status,
        secretLastFour: row.secret_last_four,
        lastTestedAt: row.last_tested_at,
        lastTestStatus: row.last_test_status,
        lastTestHttpStatus: row.last_test_http_status,
        lastTestMessage: row.last_test_message,
        disconnectedAt: row.disconnected_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    }
    activeRouteCount = routeResult.count ?? 0;
    if (!deliveryResult.error && deliveryResult.data) {
      const row = deliveryResult.data;
      lastDelivery = {
        status: row.status,
        eventType: row.event_type,
        responseStatus: row.response_status,
        lastError: row.last_error,
        lastAttemptAt: row.last_attempt_at,
        createdAt: row.created_at,
      };
    }
  }

  return <>
    <PageHeader title="Integrações" description="Gerencie conexões de pagamento e integrações operacionais do Prosperity Pay." />

    <section className="panel operational-panel">
      <h2>Mercado Pago</h2>
      {error ? <p className="form-error">Não foi possível consultar a conexão.</p> : connection ? <>
        <p>Conta: {connection.external_account_id}</p>
        <p>Status: {effectiveStatus} · {connection.live_mode ? "Produção" : "Teste"}</p>
        <p>Conectada em {formatDate(connection.connected_at)}</p>
        <p>Token válido até {formatDate(connection.token_expires_at)}</p>
      </> : <p>Nenhuma conta conectada.</p>}
      <Link href="/api/integrations/mercadopago/connect" className="primary-button">{connection ? "Reconectar Mercado Pago" : "Conectar Mercado Pago"}</Link>
    </section>

    {isPlatformAdmin && <CrmProsperityIntegration
      integration={crmIntegration}
      fallbackConfigured={Boolean(env.crmProsperityWebhookUrl && env.crmProsperityWebhookSecret)}
      activeRouteCount={activeRouteCount}
      lastDelivery={lastDelivery}
    />}
  </>;
}
