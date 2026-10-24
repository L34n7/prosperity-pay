import { getFinanceView } from "@/lib/finance-view";
import { PageHeader } from "@/components/ui/page-header";
import { formatCents } from "@/lib/operational";

export const dynamic = "force-dynamic";

const TIME_ZONE = "America/Sao_Paulo";

function datePart(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: TIME_ZONE,
  }).format(parsed);
}

function timePart(value: string | null | undefined) {
  if (!value) return "";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed);
}

function DateTimeCell({ value }: { value: string | null | undefined }) {
  return (
    <span className="date-time-cell">
      <strong>{datePart(value)}</strong>
      {timePart(value) && <span>{timePart(value)}</span>}
    </span>
  );
}

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
    if (commission.commission_type === "accredited") return "Credenciado";
    return commissionPartnerTypes[commission.id] === "accredited"
      ? "Credenciado"
      : "Afiliado";
  };

  const statusLabel = (commission: (typeof commissions)[number]) => {
    const status = effective(commission);
    if (status === "pending") return "Retido";
    if (status === "available") return "Liberado";
    if (status === "paid") return "Pago";
    if (status === "reversed") return "Estornado";
    if (status === "cancelled") return "Cancelado";
    return status;
  };

  const statusDate = (commission: (typeof commissions)[number]) => {
    const status = effective(commission);
    if (status === "available") return commission.available_at;
    if (status === "paid") return commission.paid_at ?? commission.available_at;
    if (status === "reversed") {
      return commission.reversed_at ?? commission.updated_at ?? commission.created_at;
    }
    if (status === "cancelled") {
      return commission.updated_at ?? commission.created_at;
    }
    return commission.created_at;
  };

  const statusBadgeClass = (commission: (typeof commissions)[number]) => {
    const status = effective(commission);
    if (status === "available") return "available";
    if (status === "paid") return "paid";
    if (status === "reversed") return "reversed";
    if (status === "cancelled") return "cancelled";
    return "pending";
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
        <h2>Comissões</h2>
        {valid.length ? (
          <div className="payment-report-table-wrap">
            <table className="payment-report-table commission-report-table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Produto / oferta</th>
                  <th>Valor</th>
                  <th>Data compra</th>
                  <th>Data status</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {valid.map((commission) => {
                  const order = commission.payments?.orders;
                  const customer = order?.customers;
                  const purchaseDate =
                    order?.paid_at ??
                    commission.payments?.paid_at ??
                    commission.created_at;

                  return (
                    <tr key={commission.id}>
                      <td>
                        <strong>{customer?.name || "Cliente"}</strong>
                        <span>{customer?.email || "E-mail não informado"}</span>
                      </td>
                      <td>
                        <strong>{order?.products?.name ?? "Produto"}</strong>
                        <span>
                          {order?.offers?.name ?? "Oferta"} · {partnerLabel(commission)}
                        </span>
                      </td>
                      <td className="commission-report-value">
                        {formatCents(commission.amount_cents)}
                      </td>
                      <td>
                        <DateTimeCell value={purchaseDate} />
                      </td>
                      <td>
                        <DateTimeCell value={statusDate(commission)} />
                      </td>
                      <td>
                        <span
                          className={
                            "status-badge status-" + statusBadgeClass(commission)
                          }
                        >
                          <span aria-hidden="true" />
                          {statusLabel(commission)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p>Nenhuma comissão registrada até o momento.</p>
        )}
      </section>
    </>
  );
}
