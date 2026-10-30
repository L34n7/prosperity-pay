import { redirect } from "next/navigation";
import { BadgeCheck, BadgeDollarSign, BriefcaseBusiness, Clock3, Coins, HandCoins, ReceiptText, TrendingUp, Users } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { ProducerAccreditedFilters } from "@/components/partners/producer-accredited-filters";
import { getProducerAccreditedReport } from "@/lib/partners/producer-accredited-report";
import { formatCents } from "@/lib/operational";
import styles from "./producer-accredited.module.css";

export const dynamic = "force-dynamic";

type Params = Promise<Record<string, string | string[] | undefined>>;
function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function dateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit",
    year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(value));
}

function memberStatus(value: string) {
  if (value === "active") return "Ativo";
  if (value === "pending") return "Pendente";
  if (value === "suspended") return "Suspenso";
  if (value === "rejected") return "Rejeitado";
  return value || "Não informado";
}

export default async function Page({ searchParams }: { searchParams: Params }) {
  const params = await searchParams;
  const report = await getProducerAccreditedReport({
    month: first(params.mes),
    productId: first(params.produto),
  });
  if (!report) redirect("/dashboard");

  const t = report.totals;
  const indicators = [
    { label: "Total faturado", value: formatCents(t.grossCents), note: `${t.sales} vendas aprovadas no mês`, icon: TrendingUp, kind: "primary" },
    { label: "Comissões geradas", value: formatCents(t.generatedCents), note: "Comissões válidas dos credenciados", icon: BadgeDollarSign, kind: "gold" },
    { label: "Total pago", value: formatCents(t.paidCents), note: "Saques efetivamente pagos no mês selecionado", icon: HandCoins, kind: "blue" },
    { label: "Em caixa", value: formatCents(t.availableCents), note: "Comissões liberadas ainda não pagas", icon: Coins, kind: "primary" },
    { label: "Em retenção", value: formatCents(t.pendingCents), note: "Aguardando prazo de liberação", icon: Clock3, kind: "orange" },
    { label: "Credenciados ativos", value: String(t.active), note: `${t.selling} com vendas no mês · ${t.partners} cadastrados`, icon: Users, kind: "purple" },
    { label: "Faturado geral", value: formatCents(t.generalGrossCents), note: "Acumulado desde o início · sem influência dos filtros", icon: TrendingUp, kind: "gold" },
    { label: "Comissões gerais", value: formatCents(t.generalCommissionCents), note: "Comissões acumuladas · sem influência dos filtros", icon: BadgeDollarSign, kind: "purple" },
  ] as const;

  return (
    <div className={styles.root}>
      <PageHeader
        eyebrow="Visão do produtor"
        title="Gestão de credenciados"
        description="Faturamento, produção de vendas e comissões dos credenciados vinculados aos seus produtos."
      />
      <section className={styles.filterPanel}>
        <div className={styles.filterHeading}>
          <div>
            <span className={styles.eyebrow}>Período analisado</span>
            <h2>{report.monthLabel}</h2>
            <p>Vendas aprovadas entre o primeiro e o último dia do mês, horário de Brasília.</p>
          </div>
          <span className={styles.periodTag}><CalendarBadge /> Fechamento mensal</span>
        </div>
        <ProducerAccreditedFilters
          key={`${report.month}:${report.productId}`}
          month={report.month} productId={report.productId} products={report.products}
        />
      </section>

      <section className={styles.kpis} aria-label="Indicadores de credenciados">
        {indicators.map((item) => {
          const Icon = item.icon;
          return (
            <article key={item.label} className={`${styles.kpi} ${styles[item.kind]}`}>
              <div className={styles.kpiIcon}><Icon size={20} /></div>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <small>{item.note}</small>
            </article>
          );
        })}
      </section>

      <div className={styles.explanation}>
        <BadgeCheck size={18} />
        <p><strong>Como interpretar:</strong> faturamento representa vendas aprovadas atribuídas a credenciados, inclusive renovações. <strong>Total pago</strong> e o valor <strong>Pago</strong> de cada credenciado consideram exclusivamente os saques com status pago e data de pagamento dentro do mês selecionado, mesmo que as comissões tenham sido geradas em outros meses. <strong>Em caixa</strong> e <strong>retenção</strong> refletem a situação atual das comissões das vendas do mês filtrado. Os saques são realizados por carteira do credenciado e não podem ser separados com segurança por produto. <strong>Faturado geral</strong> e <strong>Comissões gerais</strong> abrangem todo o histórico dos seus produtos, sem influência dos filtros. O saldo efetivo de saque está no módulo Saldo.</p>
      </div>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <span className={styles.eyebrow}>Desempenho individual</span>
            <h2>Credenciados da sua operação</h2>
            <p>Compare faturamento, comissões e carteira de cada credenciado.</p>
          </div>
          <span className={styles.counter}><BriefcaseBusiness size={16} /> {report.partners.length} credenciados</span>
        </div>

        {report.partners.length ? (
          <div className={styles.partnerGrid}>
            {report.partners.map((partner) => (
              <article className={styles.partnerCard} key={partner.id}>
                <div className={styles.partnerHeader}>
                  <div className={styles.avatar}>{partner.name.trim().slice(0, 1).toUpperCase()}</div>
                  <div className={styles.identity}>
                    <h3>{partner.name}</h3>
                    <p>{partner.email}</p>
                    <span>{partner.products.join(" · ")}</span>
                  </div>
                  <span className={`${styles.status} ${partner.status === "active" ? styles.active : ""}`}>
                    {memberStatus(partner.status)}
                  </span>
                </div>
                <div className={styles.partnerMain}>
                  <div><span>Faturamento no mês</span><strong>{formatCents(partner.grossCents)}</strong></div>
                  <div><span>Comissões geradas</span><strong>{formatCents(partner.generatedCents)}</strong></div>
                </div>
                <div className={styles.partnerMetrics}>
                  <div><span>Vendas</span><strong>{partner.salesCount}</strong></div>
                  <div><span>Clientes</span><strong>{partner.customersCount}</strong></div>
                  <div><span>Saques pagos no mês</span><strong>{formatCents(partner.paidCents)}</strong></div>
                  <div><span>Em caixa</span><strong>{formatCents(partner.availableCents)}</strong></div>
                  <div><span>Retido</span><strong>{formatCents(partner.pendingCents)}</strong></div>
                  <div><span>Última venda</span><strong className={styles.dateValue}>{dateTime(partner.lastSale)}</strong></div>
                </div>
                <div className={styles.partnerFoot}>
                  <div>
                    <span>Credenciado desde {dateTime(partner.since)}</span>
                    <small>Código: {partner.codes.join(" · ")}</small>
                  </div>
                </div>
                <details className={styles.details}>
                  <summary><ReceiptText size={16} /> Ver vendas e renovações <span>{partner.salesCount}</span></summary>
                  {partner.sales.length ? (
                    <div className={styles.tableScroll}>
                      <table className={styles.table}>
                        <thead><tr><th>Pedido</th><th>Cliente</th><th>Pagamento</th><th>Faturamento</th><th>Comissão</th><th>Situação</th></tr></thead>
                        <tbody>
                          {partner.sales.map((sale) => (
                            <tr key={sale.id}>
                              <td>#{sale.orderNumber}</td>
                              <td><strong>{sale.customer}</strong><small>{sale.customerEmail}</small><small>{sale.product}</small></td>
                              <td>{dateTime(sale.paidAt)}</td>
                              <td>{formatCents(sale.grossCents)}</td>
                              <td>{formatCents(sale.commissionCents)}</td>
                              <td><span className={styles.saleStatus}>{sale.commissionStatus}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className={styles.emptyDetail}>Nenhuma venda aprovada deste credenciado no período selecionado.</p>
                  )}
                </details>
              </article>
            ))}
          </div>
        ) : (
          <div className={styles.emptyState}>
            <Users size={28} />
            <h3>Nenhum credenciado encontrado</h3>
            <p>Cadastre ou aprove credenciados no gerenciamento de afiliados dos seus produtos. Quando houver indicações, os indicadores aparecerão aqui.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function CalendarBadge() {
  return <Clock3 size={15} aria-hidden="true" />;
}
