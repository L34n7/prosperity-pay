import { getFinanceView } from "@/lib/finance-view";
import { PageHeader } from "@/components/ui/page-header";
import { formatCents,formatDate } from "@/lib/operational";
export const dynamic="force-dynamic";
export default async function Page(){
 const {commissions}=await getFinanceView();
 const effective=(c:typeof commissions[number])=>c.status==="pending"&&new Date(c.available_at)<=new Date()?"available":c.status;
 const totals=(status:string)=>formatCents(commissions.filter(c=>effective(c)===status).reduce((sum,c)=>sum+Number(c.amount_cents),0));
 return <><PageHeader title="Comissões" description="Valores de afiliado e coprodução gerados por vendas confirmadas."/><section className="operational-stats">{["pending","available","paid"].map(s=><article className="panel operational-stat" key={s}><span>{s}</span><strong>{totals(s)}</strong></article>)}</section><section className="panel operational-panel">{commissions.length?commissions.map(c=><div className="record-row" key={c.id}><strong>{c.commission_type==="affiliate"?"Afiliado":"Coprodutor"} · {c.payments?.orders?.products?.name} / {c.payments?.orders?.offers?.name}</strong><span>{formatCents(c.amount_cents)} · {effective(c)}</span><span>Liberação: {formatDate(c.available_at)}</span></div>):<p>Nenhuma comissão registrada.</p>}</section></>;
}
