import { getFinanceView } from "@/lib/finance-view";
import { PageHeader } from "@/components/ui/page-header";
import { formatCents, formatDate } from "@/lib/operational";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { commissions, commissionPartnerTypes } = await getFinanceView();
  const effective = (commission: typeof commissions[number]) =>
    commission.status === "pending" &&
    new Date(commission.available_at) <= new Date()
      ? "available"
      : commission.status;
  const totals = (status: string) =>
    formatCents(
      commissions
        .filter((commission) => effective(commission) === status)
        .reduce((sum, commission) => sum + Number(commission.amount_cents), 0),
    );
  const partnerLabel = (commission: typeof commissions[number]) => {
    if (commission.commission_type === "coproducer") return "Coprodutor";
    return commissionPartnerTypes[commission.id] === "accredited"
      ? "Credenciado"
      : "Afiliado";
  };

  return (
    <>
      <PageHeader
        title="Comissões"
        description="Valores de afiliado, credenciado e coprodução gerados por vendas confirmadas."
      />
      <section className="operational-stats">
        {["pending", "available", "paid"].map((status) => (
          <article className="panel operational-stat" key={status}>
            <span>{status}</span>
            <strong>{totals(status)}</strong>
          </article>
        ))}
      </section>
      <section className="panel operational-panel">
        {commissions.length ? (
          commissions.map((commission) => (
            <div className="record-row" key={commission.id}>
              <strong>
                {partnerLabel(commission)} · {commission.payments?.orders?.products?.name} /{" "}
                {commission.payments?.orders?.offers?.name}
              </strong>
              <span>
                {formatCents(commission.amount_cents)} · {effective(commission)}
              </span>
              <span>Liberação: {formatDate(commission.available_at)}</span>
            </div>
          ))
        ) : (
          <p>Nenhuma comissão registrada.</p>
        )}
      </section>
    </>
  );
}
