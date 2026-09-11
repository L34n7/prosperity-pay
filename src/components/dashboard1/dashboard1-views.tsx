import {
  ArrowDownRight,
  ArrowUpRight,
  BadgeDollarSign,
  BanknoteArrowUp,
  CalendarClock,
  CircleCheckBig,
  CircleDollarSign,
  Clock3,
  CreditCard,
  Link2,
  Percent,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  UserRoundCheck,
  Users,
  WalletCards,
} from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { affiliates, commissions, payments, paymentVolume } from "@/lib/dashboard/mock-data";
import { dateFormatter, moneyFormatter } from "@/lib/dashboard/formatters";
import type { ConceptMetric, ConceptModule } from "./dashboard1-types";
import styles from "./dashboard1.module.css";

const metricsByModule: Record<ConceptModule, ConceptMetric[]> = {
  overview: [
    { label: "Volume processado", value: "R$ 162.640", detail: "no período", trend: "+18,4%", icon: WalletCards },
    { label: "Receita líquida", value: "R$ 139.820", detail: "após custos", trend: "+15,2%", icon: CircleDollarSign },
    { label: "Comissões", value: "R$ 4.842", detail: "a liberar", trend: "−3,1%", icon: BadgeDollarSign, tone: "gold" },
    { label: "Aprovação", value: "92,8%", detail: "dos pagamentos", trend: "+2,6%", icon: Percent },
  ],
  payments: [
    { label: "Aprovados", value: "1.148", detail: "92,8% do total", trend: "+12,6%", icon: CircleCheckBig },
    { label: "Em análise", value: "37", detail: "processando agora", icon: Clock3, tone: "neutral" },
    { label: "Ticket médio", value: "R$ 284", detail: "por transação", trend: "+5,4%", icon: CreditCard },
    { label: "Valor estornado", value: "R$ 1.397", detail: "3 pagamentos", trend: "−8,2%", icon: RefreshCcw, tone: "gold" },
  ],
  subscriptions: [
    { label: "Assinaturas ativas", value: "842", detail: "clientes ativos", trend: "+9,7%", icon: RefreshCcw },
    { label: "Receita recorrente", value: "R$ 128.374", detail: "MRR atual", trend: "+14,2%", icon: CircleDollarSign },
    { label: "Renovações", value: "96,4%", detail: "taxa mensal", trend: "+1,8%", icon: ShieldCheck },
    { label: "A vencer", value: "54", detail: "próximos 7 dias", icon: CalendarClock, tone: "gold" },
  ],
  affiliates: [
    { label: "Parceiros ativos", value: "28", detail: "programa atual", trend: "+12%", icon: UserRoundCheck },
    { label: "Vendas indicadas", value: "117", detail: "neste período", trend: "+21,5%", icon: WalletCards },
    { label: "Volume gerado", value: "R$ 34.184", detail: "por afiliados", trend: "+18,7%", icon: CircleDollarSign },
    { label: "Comissão disponível", value: "R$ 1.515", detail: "para repasse", icon: BadgeDollarSign, tone: "gold" },
  ],
  commissions: [
    { label: "Comissões geradas", value: "R$ 5.884", detail: "no período", trend: "+17,8%", icon: BadgeDollarSign },
    { label: "Disponível", value: "R$ 1.515", detail: "para pagamento", icon: BanknoteArrowUp },
    { label: "Em carência", value: "R$ 1.843", detail: "liberação em 7 dias", icon: CalendarClock, tone: "gold" },
    { label: "Pago no mês", value: "R$ 4.928", detail: "18 repasses", trend: "+11,3%", icon: CircleCheckBig },
  ],
};

const moduleCopy: Record<ConceptModule, { eyebrow: string; title: string; accent: string; description: string }> = {
  overview: { eyebrow: "Olá, Leandro", title: "Controle financeiro", accent: "em movimento.", description: "Toda a operação da Prosperity em uma visão clara, fluida e conectada." },
  payments: { eyebrow: "Operação financeira", title: "Pagamentos", accent: "sem atrito.", description: "Acompanhe cada transação do checkout até a confirmação." },
  subscriptions: { eyebrow: "Receita recorrente", title: "Assinaturas", accent: "sob controle.", description: "Renovações, recorrência e saúde da sua base em tempo real." },
  affiliates: { eyebrow: "Programa de parceiros", title: "Crescimento", accent: "compartilhado.", description: "Transforme indicações em um canal previsível de novas vendas." },
  commissions: { eyebrow: "Financeiro de parceiros", title: "Comissões", accent: "com clareza.", description: "Valores, carências e repasses organizados em um único fluxo." },
};

function ConceptMetricCard({ metric, index }: { metric: ConceptMetric; index: number }) {
  const Icon = metric.icon;
  const negative = metric.trend?.startsWith("−");
  return (
    <div className={styles.metricEntrance} style={{ animationDelay: `${90 + index * 65}ms` }}>
      <article className={`${styles.metricCard} ${metric.tone === "gold" ? styles.metricGold : ""}`}>
        <div className={styles.metricTop}>
          <span><Icon size={18} /></span>
          {metric.trend ? <em className={negative ? styles.trendDown : ""}>{negative ? <ArrowDownRight size={13} /> : <ArrowUpRight size={13} />}{metric.trend}</em> : null}
        </div>
        <p>{metric.label}</p>
        <strong>{metric.value}</strong>
        <small>{metric.detail}</small>
      </article>
    </div>
  );
}

function VolumeChart() {
  const width = 720;
  const height = 235;
  const values = paymentVolume.map((item) => item.value);
  const low = Math.min(...values) * 0.78;
  const high = Math.max(...values) * 1.08;
  const points = paymentVolume.map((item, index) => ({
    ...item,
    x: 24 + index * ((width - 48) / (paymentVolume.length - 1)),
    y: 18 + ((high - item.value) / (high - low)) * (height - 54),
  }));
  const line = points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
  const area = `${line} L${points.at(-1)?.x},${height - 28} L${points[0].x},${height - 28} Z`;

  return (
    <div className={styles.chartArea}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Volume de pagamentos nos últimos trinta dias">
        <defs>
          <linearGradient id="conceptArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#31e6aa" stopOpacity=".24" /><stop offset="1" stopColor="#31e6aa" stopOpacity="0" /></linearGradient>
          <linearGradient id="conceptLine" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#d6aa45" /><stop offset=".34" stopColor="#a9d482" /><stop offset="1" stopColor="#31e6aa" /></linearGradient>
        </defs>
        {[0, 1, 2, 3].map((item) => <line key={item} x1="24" x2={width - 24} y1={20 + item * 56} y2={20 + item * 56} className={styles.chartGrid} />)}
        <path d={area} fill="url(#conceptArea)" />
        <path d={line} className={styles.chartLine} />
        {points.map((point, index) => <circle key={point.label} cx={point.x} cy={point.y} r={index === points.length - 1 ? 5 : 3} className={styles.chartDot} />)}
        {points.map((point, index) => index % 2 === 0 ? <text key={point.label} x={point.x} y={height - 5} textAnchor="middle" className={styles.chartLabel}>{point.label}</text> : null)}
      </svg>
    </div>
  );
}

function OverviewDetail() {
  return (
    <div className={styles.detailGrid}>
      <section className={`${styles.surfaceCard} ${styles.chartCard}`}>
        <div className={styles.cardHeading}>
          <div><span>Volume de pagamentos</span><strong>R$ 162.640,00</strong></div>
          <button type="button">Últimos 30 dias</button>
        </div>
        <VolumeChart />
      </section>
      <section className={`${styles.surfaceCard} ${styles.flowCard}`}>
        <div className={styles.cardHeading}><div><span>Fluxo em tempo real</span><strong>Atividade recente</strong></div><i /></div>
        <div className={styles.activityList}>
          {payments.slice(0, 4).map((payment, index) => (
            <div key={payment.id} style={{ animationDelay: `${380 + index * 55}ms` }}>
              <span className={styles.activityIcon}>{payment.method === "PIX" ? "◆" : "▰"}</span>
              <p><strong>{payment.customer}</strong><small>{payment.method} · {payment.id}</small></p>
              <p className={styles.activityValue}><strong>{moneyFormatter.format(payment.amount)}</strong><StatusBadge status={payment.status} /></p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function PaymentsDetail() {
  return (
    <section className={`${styles.surfaceCard} ${styles.tableCard}`}>
      <div className={styles.cardHeading}><div><span>Movimentações recentes</span><strong>Pagamentos processados</strong></div><button type="button">Filtrar</button></div>
      <div className={styles.conceptTable}>
        {payments.slice(0, 5).map((payment, index) => (
          <div key={payment.id} style={{ animationDelay: `${380 + index * 50}ms` }}>
            <span className={styles.customerAvatar}>{payment.customer.split(" ").map((word) => word[0]).slice(0, 2).join("")}</span>
            <p><strong>{payment.customer}</strong><small>{payment.email}</small></p>
            <p><small>Valor</small><strong>{moneyFormatter.format(payment.amount)}</strong></p>
            <p><small>Método</small><strong>{payment.method}</strong></p>
            <p><small>Data</small><strong>{dateFormatter.format(new Date(payment.createdAt))}</strong></p>
            <StatusBadge status={payment.status} />
          </div>
        ))}
      </div>
    </section>
  );
}

function SubscriptionsDetail() {
  const plans = [
    { name: "Básico", value: 487, percent: 58, revenue: "R$ 66.719" },
    { name: "Essencial", value: 248, percent: 29, revenue: "R$ 49.352" },
    { name: "Beta", value: 107, percent: 13, revenue: "R$ 6.420" },
  ];
  return (
    <div className={styles.detailGrid}>
      <section className={`${styles.surfaceCard} ${styles.planCard}`}>
        <div className={styles.cardHeading}><div><span>Distribuição da base</span><strong>Planos ativos</strong></div><RefreshCcw size={17} /></div>
        <div className={styles.planList}>{plans.map((plan, index) => <div key={plan.name} style={{ animationDelay: `${380 + index * 70}ms` }}><span><strong>{plan.name}</strong><small>{plan.value} assinaturas</small></span><div><i style={{ width: `${plan.percent}%` }} /></div><p><strong>{plan.percent}%</strong><small>{plan.revenue}/mês</small></p></div>)}</div>
      </section>
      <section className={`${styles.surfaceCard} ${styles.renewalCard}`}>
        <span className={styles.featureIcon}><Sparkles size={19} /></span>
        <p>Próximas renovações</p>
        <strong>R$ 18.746</strong>
        <small>54 assinaturas nos próximos 7 dias</small>
        <div><i style={{ width: "78%" }} /></div>
        <em>78% com pagamento automático ativo</em>
      </section>
    </div>
  );
}

function AffiliatesDetail() {
  return (
    <section className={`${styles.surfaceCard} ${styles.peopleCard}`}>
      <div className={styles.cardHeading}><div><span>Performance de parceiros</span><strong>Afiliados em destaque</strong></div><button type="button">Ver todos</button></div>
      <div className={styles.peopleGrid}>{affiliates.map((affiliate, index) => <article key={affiliate.id} style={{ animationDelay: `${380 + index * 60}ms` }}><div><span className={styles.customerAvatar}>{affiliate.name.split(" ").map((word) => word[0]).slice(0,2).join("")}</span><p><strong>{affiliate.name}</strong><small><Link2 size={12} /> {affiliate.code}</small></p></div><dl><div><dt>Vendas</dt><dd>{affiliate.sales}</dd></div><div><dt>Volume</dt><dd>{moneyFormatter.format(affiliate.volume)}</dd></div><div><dt>Disponível</dt><dd>{moneyFormatter.format(affiliate.availableCommission)}</dd></div></dl></article>)}</div>
    </section>
  );
}

function CommissionsDetail() {
  return (
    <section className={`${styles.surfaceCard} ${styles.tableCard}`}>
      <div className={styles.cardHeading}><div><span>Movimento de comissões</span><strong>Liberações e pagamentos</strong></div><button type="button">Preparar repasse</button></div>
      <div className={`${styles.conceptTable} ${styles.commissionTable}`}>{commissions.map((commission, index) => <div key={commission.id} style={{ animationDelay: `${380 + index * 45}ms` }}><span className={styles.commissionIcon}><Users size={16} /></span><p><strong>{commission.affiliate}</strong><small>{commission.saleId} · {commission.id}</small></p><p><small>Venda</small><strong>{moneyFormatter.format(commission.saleAmount)}</strong></p><p><small>Regra</small><strong>{commission.rule}</strong></p><p><small>Comissão</small><strong>{moneyFormatter.format(commission.amount)}</strong></p><StatusBadge status={commission.status} /></div>)}</div>
    </section>
  );
}

export function Dashboard1ModuleView({ module }: { module: ConceptModule }) {
  const copy = moduleCopy[module];
  return (
    <div className={styles.moduleView}>
      <section className={styles.heroRow}>
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}><Sparkles size={13} /> {copy.eyebrow}</span>
          <h1>{copy.title} <em>{copy.accent}</em></h1>
          <p>{copy.description}</p>
        </div>
        <div className={styles.periodControl}><CalendarClock size={16} /><span>Últimos 30 dias</span></div>
      </section>
      <section className={styles.metricGrid}>
        {metricsByModule[module].map((metric, index) => <ConceptMetricCard key={metric.label} metric={metric} index={index} />)}
      </section>
      {module === "overview" ? <OverviewDetail /> : null}
      {module === "payments" ? <PaymentsDetail /> : null}
      {module === "subscriptions" ? <SubscriptionsDetail /> : null}
      {module === "affiliates" ? <AffiliatesDetail /> : null}
      {module === "commissions" ? <CommissionsDetail /> : null}
    </div>
  );
}
