export function PaymentStatusChart({payments}:{payments:{status:string}[]}){
 const counts=new Map<string,number>();payments.forEach(p=>counts.set(p.status,(counts.get(p.status)??0)+1));
 return <section className="panel operational-panel"><h2>Status dos pagamentos</h2>{payments.length?[...counts].map(([status,count])=><div className="record-row" key={status}><strong>{status}</strong><span>{count} · {Math.round(count/payments.length*100)}%</span></div>):<p>Aguardando o primeiro pagamento.</p>}</section>;
}
