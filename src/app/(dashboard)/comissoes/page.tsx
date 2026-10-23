import { getFinanceView } from "@/lib/finance-view";
import { PageHeader } from "@/components/ui/page-header";
import { formatCents, formatDate } from "@/lib/operational";

export const dynamic = "force-dynamic";

export default async function Page() {
  const {
    commissions,
    commissionPartnerTypes,
    withdrawalSummary,
  } = await getFinanceView();
  const now = Date.now();

  const effective = (commission: (typeof commissions)[number]) =>
    commission.status === "pending" &&
    new Date(commission.available_at).getTime() <= now
      ? "available"
      : commission.status;

  const valid = commissions.filter(
    (commission) =>
      commission.status !== "cancelled" && commission.status !== "reversed",
  );

  const retained = valid
    .filter((commission) => effective(commission) === "pending")
    .reduce((sum, commission) => sum + Number(commission.amount_cents), 0);

  const partnerLabel = (commission: (typeof commissions)[number]) => {
    if (commission.commission_type === "coproducer") return "Coprodutor";
    return commissionPartnerTypes[commission.id] === "accredited"
      ? "Credenciado"
      : "Afiliado";
  };

  const statusLabel = (commission: (typeof commissions)[number]) => {
    const status = effective(commission);
    if (status === "pending") return "Em retenção";
    if (status === "available") return "Liberada";
    if (status === "paid") return "Paga";
    if (status === "reversed") return "Estornada";
    if (status === "cancelled") return "Cancelada";
    return status;
  };

  return (
    <>
      <PageHeader
        title="Comissões"
        description="Acompanhe suas comissões, valores liberados e saques recebidos."
      />

      <section className="operational-stats">
        {[
          ["Em retenção", retained],
          ["Disponível para saque", withdrawalSummary.withdrawable_cents],
          ["Em saque", withdrawalSummary.processing_cents],
          ["Já sacado", withdrawalSummary.paid_cents],
        ].map(([label, value]) => (
          <article className="panel operational-stat" key={String(label)}>
            <span>{label}</span>
            <strong>{formatCents(Number(value))}</strong>
          </article>
        ))}
      </section>

      {withdrawalSummary.residual_cents > 0 &&
        withdrawalSummary.withdrawable_cents === 0 && (
          <section className="panel balance-residual-note">
            <strong>Saldo residual: {formatCents(withdrawalSummary.residual_cents)}</strong>
            <span>
              Esse valor continua na sua carteira e será somado aos próximos créditos.
              Ele ficará disponível para saque ao atingir R$ 5,00.
            </span>
          </section>
        )}

      <section className="panel operational-panel">
        {valid.length ? (
          valid.map((commission) => (
            <div className="record-row" key={commission.id}>
              <strong>
                {partnerLabel(commission)} ·{" "}
                {commission.payments?.orders?.products?.name ?? "Produto"} /{" "}
                {commission.payments?.orders?.offers?.name ?? "Oferta"}
              </strong>
              <span>{formatCents(commission.amount_cents)}</span>
              <span>{statusLabel(commission)}</span>
              <span>Liberação: {formatDate(commission.available_at)}</span>
            </div>
          ))
        ) : (
          <p>Nenhuma comissão registrada até o momento.</p>
        )}
      </section>
    </>
  );
}
