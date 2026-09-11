import { paymentStatusDistribution } from "@/lib/dashboard/mock-data";

export function PaymentStatusChart() {
  const gradient = paymentStatusDistribution.reduce(
    (result, item, index) => {
      const before = paymentStatusDistribution.slice(0, index).reduce((sum, current) => sum + current.value, 0);
      return `${result}${index ? ", " : ""}${item.color} ${before}% ${before + item.value}%`;
    },
    "",
  );

  return (
    <section className="panel status-panel">
      <div className="panel-heading">
        <div><p className="eyebrow">Distribuição</p><h2>Status dos pagamentos</h2></div>
      </div>
      <div className="donut-wrap">
        <div className="donut" style={{ background: `conic-gradient(${gradient})` }} role="img" aria-label="68% dos pagamentos aprovados">
          <div><strong>1.248</strong><span>pagamentos</span></div>
        </div>
      </div>
      <div className="status-legend">
        {paymentStatusDistribution.map((item) => (
          <div key={item.label}>
            <span><i style={{ backgroundColor: item.color }} />{item.label}</span>
            <strong>{item.value}%</strong>
          </div>
        ))}
      </div>
    </section>
  );
}
