import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { formatDate } from "@/lib/operational";
export const dynamic="force-dynamic";
export default async function Page() {
 const supabase=await createClient(); const {data:{user}}=await supabase.auth.getUser();
 const {data:connection,error}=await supabase.from("payment_provider_connections").select("external_account_id,live_mode,status,connected_at,token_expires_at").eq("owner_user_id",user!.id).order("connected_at",{ascending:false}).limit(1).maybeSingle();
 const effectiveStatus=connection?.token_expires_at&&new Date(connection.token_expires_at)<=new Date()?"expirado":connection?.status;
 return <><PageHeader title="Integrações" description="Gerencie a conta que recebe vendas diretamente no Mercado Pago."/><section className="panel operational-panel"><h2>Mercado Pago</h2>{error ? <p className="form-error">Não foi possível consultar a conexão.</p> : connection ? <><p>Conta: {connection.external_account_id}</p><p>Status: {effectiveStatus} · {connection.live_mode ? "Produção" : "Teste"}</p><p>Conectada em {formatDate(connection.connected_at)}</p><p>Token válido até {formatDate(connection.token_expires_at)}</p></> : <p>Nenhuma conta conectada.</p>}<Link href="/api/integrations/mercadopago/connect" className="primary-button">{connection ? "Reconectar Mercado Pago" : "Conectar Mercado Pago"}</Link></section></>;
}
