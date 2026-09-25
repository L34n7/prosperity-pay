import { BadgeCheck, CalendarClock, CircleDollarSign, UsersRound } from "lucide-react";
import type { PartnerPortfolio } from "@/lib/partners/customer-portfolio";

function money(cents: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(cents || 0) / 100);
}

function date(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR").format(parsed);
}

function subscriptionLabel(status: string | null) {
  const labels: Record<string, string> = {
    active: "Ativa",
    pending: "Pendente",
    past_due: "Vencida",
    cancelled: "Cancelada",
    paused: "Pausada",
  };
  return status ? labels[status] ?? status : "Compra avulsa";
}

export function PartnerCustomerPortfolio({
  portfolio,
  title,
  description,
  emptyText,
}: {
  portfolio: PartnerPortfolio;
  title: string;
  description: string;
  emptyText: string;
}) {
  return (
    <section className="panel operational-panel">
      <div className="premium-report-head" style={{ padding: "0 0 18px", borderBottom: 0 }}>
        <div>
          <span>Relacionamento comercial</span>
          <h2>{title}</h2>
          <p style={{ margin: 0 }}>{description}</p>
        </div>
      </div>

      <div className="affiliate-result-grid" style={{ marginBottom: 20 }}>
        <div><small>Clientes</small><strong>{portfolio.summary.totalCustomers}</strong></div>
        <div><small>Assinaturas ativas</small><strong>{portfolio.summary.activeCustomers}</strong></div>
        <div><small>Receita recorrente da carteira</small><strong>{money(portfolio.summary.recurringRevenueCents)}</strong></div>
        <div><small>Comissões geradas</small><strong>{money(portfolio.summary.commissionTotalCents)}</strong></div>
      </div>

      {portfolio.customers.length ? (
        <div className="data-table-wrap">
          <table className="data-table" style={{ minWidth: 1040 }}>
            <thead>
              <tr>
                <th>Cliente</th><th>Produto / oferta</th><th>Parceiro</th><th>Assinatura</th>
                <th>Próxima renovação</th><th>Valor atual</th><th>Volume atribuído</th><th>Comissão</th>
              </tr>
            </thead>
            <tbody>
              {portfolio.customers.map((customer) => (
                <tr key={customer.key}>
                  <td>
                    <strong>{customer.customerName}</strong>
                    <span>{customer.customerEmail || (customer.fullCustomerData ? "E-mail não informado" : "Contato protegido pelo produtor")}</span>
                  </td>
                  <td><strong>{customer.productName}</strong><span>{customer.offerName || "Oferta não identificada"}</span></td>
                  <td>
                    <span className={`status-badge ${customer.partnerType === "accredited" ? "status-processing" : "status-active"}`}>
                      <span />{customer.partnerType === "accredited" ? "Credenciado" : "Afiliado"}
                    </span>
                  </td>
                  <td><strong>{subscriptionLabel(customer.subscriptionStatus)}</strong><span>Cliente desde {date(customer.customerSince)}</span></td>
                  <td><strong>{date(customer.nextDueAt)}</strong><span>Última compra {date(customer.lastPurchaseAt)}</span></td>
                  <td><strong>{customer.subscriptionId ? money(customer.currentAmountCents) : "—"}</strong><span>{customer.subscriptionId ? "mensalidade atual" : "venda avulsa"}</span></td>
                  <td><strong>{money(customer.salesVolumeCents)}</strong><span>{customer.paidOrders} pagamento(s)</span></td>
                  <td><strong>{money(customer.commissionTotalCents)}</strong><span>{money(customer.commissionAvailableCents)} disponível</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state">
          <span><UsersRound size={21} /></span>
          <strong>Nenhum cliente atribuído ainda</strong>
          <p>{emptyText}</p>
        </div>
      )}

      {portfolio.customers.length > 0 && (
        <div className="table-footer">
          <span>{portfolio.summary.totalCustomers} cliente(s) · {money(portfolio.summary.salesVolumeCents)} em vendas atribuídas</span>
          <div style={{ gap: 14 }}>
            <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}><CircleDollarSign size={13} />{money(portfolio.summary.commissionPendingCents)} pendente</span>
            <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}><BadgeCheck size={13} />{money(portfolio.summary.commissionAvailableCents)} disponível</span>
            <span style={{ display: "inline-flex", gap: 5, alignItems: "center" }}><CalendarClock size={13} />{money(portfolio.summary.commissionPaidCents)} pago</span>
          </div>
        </div>
      )}
    </section>
  );
}
