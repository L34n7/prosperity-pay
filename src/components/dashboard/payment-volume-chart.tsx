import { formatCents } from "@/lib/operational";
export function PaymentVolumeChart({payments}:{payments:{status:string;gross_amount_cents:number;paid_at:string|null}[]}){
 const days=Array.from({length:14},(_,index)=>{const date=new Date();date.setUTCHours(0,0,0,0);date.setUTCDate(date.getUTCDate()-(13-index));return date.toISOString().slice(0,10)});
 const values=days.map(day=>payments.filter(p=>p.status==="approved"&&p.paid_at?.slice(0,10)===day).reduce((sum,p)=>sum+Number(p.gross_amount_cents),0));
 const max=Math.max(1,...values);
 return <section className="panel operational-panel"><h2>Volume confirmado · 14 dias</h2><div className="finance-bars" role="img" aria-label="Volume de vendas aprovadas por dia nos últimos 14 dias">{days.map((day,index)=><div key={day} title={`${new Date(`${day}T12:00:00`).toLocaleDateString("pt-BR")}: ${formatCents(values[index])}`}><i style={{height:values[index]===0?"0%":`${Math.max(3,values[index]/max*100)}%`}}/><span>{day.slice(8)}</span></div>)}</div><p>Total: {formatCents(values.reduce((a,b)=>a+b,0))}</p></section>;
}
