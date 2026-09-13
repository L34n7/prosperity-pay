export function PaymentStatusChart({payments}:{payments:{status:string}[]}){
 const labels:Record<string,string>={pending:"Pendentes",processing:"Em processamento",approved:"Aprovados",rejected:"Recusados",cancelled:"Cancelados",refunded:"Estornados",charged_back:"Contestados"};
 const counts=new Map<string,number>(Object.keys(labels).map(status=>[status,0]));payments.forEach(p=>counts.set(p.status,(counts.get(p.status)??0)+1));
 return <section className="panel operational-panel"><h2>Status dos pagamentos</h2>{[...counts].map(([status,count])=><div className="record-row" key={status}><strong>{labels[status]??status}</strong><span>{count} · {payments.length?Math.round(count/payments.length*100):0}%</span></div>)}</section>;
}
