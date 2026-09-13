import { PaymentVolumeChart } from "@/components/dashboard/payment-volume-chart";
import { PaymentStatusChart } from "@/components/dashboard/payment-status-chart";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getFinanceView } from "@/lib/finance-view";
import { PageHeader } from "@/components/ui/page-header";
import { formatCents } from "@/lib/operational";
export const dynamic="force-dynamic";
export default async function Page() {
 const data=await getFinanceView();const {data:{user}}=await (await createClient()).auth.getUser();
 const {data:profile}=await (await createClient()).from("profiles").select("full_name").eq("id",user!.id).maybeSingle();
 const approved=data.payments.filter(p=>p.status==="approved");const volume=approved.reduce((sum,p)=>sum+Number(p.gross_amount_cents),0);
 const ownRevenue=data.orders.filter(o=>approved.some(p=>p.order_id===o.id)).reduce((sum,o)=>sum+Number(o.financial_snapshots?.producer_amount_cents??0)-(o.settlement_model==="prosperity_balance"?Number(approved.find(p=>p.order_id===o.id)?.provider_fee_amount_cents??0):0),0);
 const affiliate=data.commissions.filter(c=>c.commission_type==="affiliate").reduce((sum,c)=>sum+Number(c.amount_cents),0);
 const coproducer=data.commissions.filter(c=>c.commission_type==="coproducer").reduce((sum,c)=>sum+Number(c.amount_cents),0);
 return <><PageHeader eyebrow={`Olá, ${profile?.full_name?.split(" ")[0]??user?.email?.split("@")[0]??"usuário"}`} title="Dashboard financeiro" description="Acompanhe seus resultados confirmados."/>
 <section className="operational-stats">{[["Vendas",String(approved.length)],["Volume processado",formatCents(volume)],["Receita dos produtos",formatCents(ownRevenue)],["Comissões de afiliado",formatCents(affiliate)],["Coprodução",formatCents(coproducer)],["Saldo pendente",formatCents(data.balance.pending_cents)],["Saldo disponível",formatCents(data.balance.available_cents)],["Saques",formatCents(data.withdrawals.reduce((sum,w)=>sum+Number(w.amount_cents),0))]].map(([label,value])=><article className="panel operational-stat" key={label}><span>{label}</span><strong>{value}</strong></article>)}</section>
 {!data.orders.length&&<section className="panel operational-panel"><h2>Comece a vender</h2><p>Sua conta começa zerada. Configure seu primeiro produto e seus dados financeiros.</p><div className="button-row"><Link href="/produtos" className="primary-button">Criar produto</Link><Link href="/integracoes" className="secondary-button">Conectar Mercado Pago</Link><Link href="/conta" className="secondary-button">Dados financeiros</Link></div></section>}
 <div className="finance-charts"><PaymentVolumeChart payments={data.payments}/><PaymentStatusChart payments={data.payments}/></div>
 <section className="panel operational-panel"><h2>Pagamentos recentes</h2>{data.payments.length?data.payments.slice(0,5).map(p=><div className="record-row" key={p.id}><span>{p.external_reference}</span><strong>{formatCents(p.gross_amount_cents)}</strong><span>{p.status}</span></div>):<p>Nenhum pagamento registrado.</p>}<Link href="/pagamentos">Ver pagamentos →</Link></section></>;
}
