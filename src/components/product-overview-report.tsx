"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BadgeDollarSign,
  CreditCard,
  Handshake,
  Layers3,
  QrCode,
  ReceiptText,
  ShoppingBag,
  Tags,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { RECURRENCE_OPTIONS, type ProductPaymentType, type RecurrenceFrequency } from "@/lib/domain/product-rules";
import { formatCents, requestJson } from "@/lib/operational";
import styles from "./product-overview-report.module.css";

type Product = {
  id: string;
  status: string;
  settlement_model: string;
  payment_type: ProductPaymentType;
  product_type: "digital" | "physical";
  category: string | null;
  support_display_name: string | null;
  support_email: string | null;
  support_whatsapp: string | null;
  recurrence_frequency: RecurrenceFrequency | null;
  different_first_charge: boolean;
  first_charge_cents: number | null;
  recurring_price_cents: number | null;
  main_offer_price_cents: number | null;
};

type Offer = {
  id: string;
  name: string;
  price_cents: number;
  billing_type: string;
  status: string;
  checkout_slug: string;
  affiliate_commission_bps: number;
  affiliate_enabled: boolean;
  max_installments: number;
  payment_card_enabled: boolean;
  payment_pix_enabled: boolean;
  primary_payment_method: "card" | "pix";
};

type Report = {
  summary: {
    offer_count: number;
    active_offer_count: number;
    affiliate_count: number;
    coproducer_count: number;
    completed_sales: number;
    total_sales_cents: number;
    average_ticket_cents: number;
    pix_sales: number;
    pix_sales_cents: number;
    card_sales: number;
    card_sales_cents: number;
    other_sales: number;
    other_sales_cents: number;
  };
  sales: Array<{
    id: string;
    customer_name: string;
    customer_email: string;
    plan_name: string;
    offer_name: string;
    amount_cents: number;
    paid_at: string | null;
    affiliate_sale: boolean;
  }>;
  offers: Array<{
    id: string;
    name: string;
    status: string;
    price_cents: number;
    billing_type: string;
    sales_count: number;
    total_sales_cents: number;
    pix_count: number;
    pix_sales_cents: number;
    card_count: number;
    card_sales_cents: number;
    other_count: number;
    other_sales_cents: number;
    affiliate_sales_count: number;
    direct_sales_count: number;
  }>;
  affiliates: Array<{
    id: string;
    user_id: string;
    name: string;
    code: string;
    sales_count: number;
    total_sales_cents: number;
    commission_cents: number;
  }>;
  coproducers: Array<{
    id: string;
    user_id: string;
    name: string;
    email: string | null;
    participation_bps: number;
    offer_id: string | null;
    sales_count: number;
    total_sales_cents: number;
    participation_cents: number;
  }>;
};

function statusLabel(status: string) {
  switch (status) {
    case "active": return "Ativo";
    case "inactive": return "Inativo";
    case "archived": return "Arquivado";
    default: return "Rascunho";
  }
}

function methods(offer: Offer) {
  return [offer.payment_card_enabled ? "Cartão" : null, offer.payment_pix_enabled ? "PIX" : null].filter(Boolean).join(" + ") || "Nenhum";
}

function number(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function percent(value: number, total: number) {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function saleDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function productPrice(product: Product) {
  return product.payment_type === "recurring" ? product.recurring_price_cents : product.main_offer_price_cents;
}

export function ProductOverviewReport({ product, offers }: { product: Product; offers: Offer[] }) {
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    const run = async () => {
      try {
        const result = await requestJson<Report>(`/api/products/${product.id}/overview-report`);
        if (!alive) return;
        setReport(result);
        setError("");
      } catch (cause) {
        if (!alive) return;
        setError(cause instanceof Error ? cause.message : "Não foi possível carregar o relatório do produto.");
      } finally {
        if (alive) setLoading(false);
      }
    };
    void run();
    return () => { alive = false; };
  }, [product.id]);

  const offerNames = useMemo(() => new Map(offers.map(offer => [offer.id, offer.name])), [offers]);
  const price = productPrice(product);
  const recurrence = RECURRENCE_OPTIONS.find(option => option.value === product.recurrence_frequency)?.label;
  const totalMethods = report ? report.summary.pix_sales + report.summary.card_sales + report.summary.other_sales : 0;

  return <div className={styles.dashboard}>
    <section className={styles.section}>
      <div className={styles.sectionHeading}>
        <div><span>Configuração</span><h2>Informações do produto</h2><p>Resumo comercial e operacional configurado para este produto.</p></div>
      </div>
      <div className={styles.factsGrid}>
        <Fact label="Status" value={statusLabel(product.status)}/>
        <Fact label="Tipo" value={product.product_type === "physical" ? "Produto físico" : "Produto digital"}/>
        <Fact label="Categoria" value={product.category || "Sem categoria"}/>
        <Fact label="Preço principal" value={price ? formatCents(price) : "Não definido"}/>
        <Fact label="Cobrança" value={product.payment_type === "recurring" ? `Recorrente${recurrence ? ` · ${recurrence}` : ""}` : "Pagamento único"}/>
        <Fact label="Recebimento" value={product.settlement_model === "connected_account" ? "Direto no Mercado Pago" : "Saldo Prosperity Pay"}/>
        {product.payment_type === "recurring" && <Fact label="Primeira cobrança" value={product.different_first_charge ? formatCents(product.first_charge_cents ?? 0) : "Mesmo valor da recorrência"}/>} 
        <Fact label="SAC" value={product.support_display_name || product.support_email || product.support_whatsapp || "Não informado"}/>
      </div>
    </section>

    <section className={styles.section}>
      <div className={styles.sectionHeading}>
        <div><span>Comercial</span><h2>Ofertas do produto</h2><p>Preço, status, cobrança e meios disponíveis em cada oferta.</p></div>
        <strong>{offers.length} {offers.length === 1 ? "oferta" : "ofertas"}</strong>
      </div>
      {!offers.length ? <Empty text="Nenhuma oferta cadastrada ainda."/> : <div className={styles.offerGrid}>
        {offers.map(offer => <article className={styles.offerCard} key={offer.id}>
          <div className={styles.offerTop}>
            <div><small>{offer.billing_type === "recurring" ? "Recorrente" : "Pagamento único"}</small><h3>{offer.name}</h3></div>
            <span className={offer.status === "active" ? styles.activeBadge : styles.mutedBadge}>{statusLabel(offer.status)}</span>
          </div>
          <strong className={styles.offerPrice}>{formatCents(offer.price_cents)}</strong>
          <div className={styles.offerMeta}>
            <span><WalletCards size={14}/>{methods(offer)}</span>
            <span><Layers3 size={14}/>{offer.billing_type === "recurring" ? "Assinatura" : `Até ${offer.max_installments}x`}</span>
            <span><UsersRound size={14}/>{offer.affiliate_enabled ? `Afiliados · ${offer.affiliate_commission_bps / 100}%` : "Afiliados desativados"}</span>
          </div>
        </article>)}
      </div>}
    </section>

    <section className={`${styles.section} ${styles.reportSection}`}>
      <div className={styles.sectionHeading}>
        <div><span>Performance</span><h2>Relatório geral do produto</h2><p>Indicadores calculados a partir das vendas concluídas e das alocações financeiras registradas.</p></div>
      </div>

      {loading ? <div className={styles.loadingGrid}>{Array.from({ length: 8 }).map((_, index) => <i key={index}/>)}</div> : error ? <div className={styles.reportError}>{error}</div> : report && <>
        <div className={styles.kpiGrid}>
          <Kpi icon={<BadgeDollarSign size={19}/>} label="Faturamento bruto" value={formatCents(report.summary.total_sales_cents)} hint="Vendas concluídas" accent/>
          <Kpi icon={<ShoppingBag size={18}/>} label="Vendas concluídas" value={number(report.summary.completed_sales)} hint="Pedidos pagos"/>
          <Kpi icon={<ReceiptText size={18}/>} label="Ticket médio" value={formatCents(report.summary.average_ticket_cents)} hint="Por venda concluída"/>
          <Kpi icon={<Tags size={18}/>} label="Ofertas ativas" value={`${report.summary.active_offer_count}/${report.summary.offer_count}`} hint="Ativas / total"/>
          <Kpi icon={<UsersRound size={18}/>} label="Afiliados" value={number(report.summary.affiliate_count)} hint="Ativos no produto"/>
          <Kpi icon={<Handshake size={18}/>} label="Coprodutores" value={number(report.summary.coproducer_count)} hint="Participações ativas"/>
          <Kpi icon={<QrCode size={18}/>} label="Vendas PIX" value={number(report.summary.pix_sales)} hint={formatCents(report.summary.pix_sales_cents)}/>
          <Kpi icon={<CreditCard size={18}/>} label="Vendas cartão" value={number(report.summary.card_sales)} hint={formatCents(report.summary.card_sales_cents)}/>
        </div>

        <div className={styles.mixAndOffers}>
          <article className={styles.panelCard}>
            <div className={styles.panelHeading}><div><small>Meios de pagamento</small><h3>PIX x cartão</h3></div><WalletCards size={20}/></div>
            <PaymentRow label="PIX" icon={<QrCode size={17}/>} count={report.summary.pix_sales} amount={report.summary.pix_sales_cents} ratio={percent(report.summary.pix_sales, totalMethods)}/>
            <PaymentRow label="Cartão" icon={<CreditCard size={17}/>} count={report.summary.card_sales} amount={report.summary.card_sales_cents} ratio={percent(report.summary.card_sales, totalMethods)}/>
            {report.summary.other_sales > 0 && <PaymentRow label="Não identificado" icon={<WalletCards size={17}/>} count={report.summary.other_sales} amount={report.summary.other_sales_cents} ratio={percent(report.summary.other_sales, totalMethods)}/>} 
          </article>

          <article className={styles.panelCard}>
            <div className={styles.panelHeading}><div><small>Origem das vendas</small><h3>Resumo por oferta</h3></div><Tags size={20}/></div>
            <div className={styles.quickOfferList}>
              {report.offers.map(offer => <div key={offer.id}><span><strong>{offer.name}</strong><small>{offer.sales_count} venda(s)</small></span><strong>{formatCents(offer.total_sales_cents)}</strong></div>)}
              {!report.offers.length && <Empty text="Sem ofertas para analisar."/>}
            </div>
          </article>
        </div>

        <ReportTable
          eyebrow="Vendas"
          title="Vendas concluídas"
          description="Comprador, e-mail, plano aplicado, valor e data de cada venda confirmada."
          columns={["Comprador", "E-mail", "Plano", "Valor", "Data", "Origem"]}
          empty="Nenhuma venda concluída."
          rows={report.sales.map(sale => ({
            key: sale.id,
            cells: [
              <div className={styles.primaryCell} key="buyer"><strong>{sale.customer_name}</strong><small>{sale.offer_name}</small></div>,
              sale.customer_email,
              <strong key="plan">{sale.plan_name}</strong>,
              <strong key="amount">{formatCents(sale.amount_cents)}</strong>,
              saleDate(sale.paid_at),
              sale.affiliate_sale ? "Afiliado" : "Direta",
            ],
          }))}
        />

        <ReportTable
          eyebrow="Ofertas"
          title="Desempenho por oferta"
          description="Quantidade e faturamento concluído, com separação por meio de pagamento e origem da venda."
          columns={["Oferta", "Vendas", "Faturamento", "PIX", "Cartão", "Afiliado / Direto"]}
          empty="Nenhuma oferta disponível."
          rows={report.offers.map(offer => ({
            key: offer.id,
            cells: [
              <div className={styles.primaryCell} key="offer"><strong>{offer.name}</strong><small>{statusLabel(offer.status)} · {formatCents(offer.price_cents)}</small></div>,
              number(offer.sales_count),
              <strong key="revenue">{formatCents(offer.total_sales_cents)}</strong>,
              `${offer.pix_count} · ${formatCents(offer.pix_sales_cents)}`,
              `${offer.card_count} · ${formatCents(offer.card_sales_cents)}`,
              `${offer.affiliate_sales_count} / ${offer.direct_sales_count}`,
            ],
          }))}
        />

        <div className={styles.partnerGrid}>
          <ReportTable
            compact
            eyebrow="Parceiros"
            title="Afiliados"
            description="Vendas atribuídas e comissão financeira registrada para cada afiliado ativo."
            columns={["Afiliado", "Vendas", "Gerado", "Comissão"]}
            empty="Nenhum afiliado ativo neste produto."
            rows={report.affiliates.map(affiliate => ({
              key: affiliate.id,
              cells: [
                <div className={styles.primaryCell} key="affiliate"><strong>{affiliate.name}</strong><small>Ref. {affiliate.code}</small></div>,
                number(affiliate.sales_count),
                formatCents(affiliate.total_sales_cents),
                <strong key="commission">{formatCents(affiliate.commission_cents)}</strong>,
              ],
            }))}
          />

          <ReportTable
            compact
            eyebrow="Parceiros"
            title="Coprodutores"
            description="Vendas com participação e valor financeiro destinado a cada coprodutor."
            columns={["Coprodutor", "Vendas", "Gerado", "Participação"]}
            empty="Nenhum coprodutor ativo neste produto."
            rows={report.coproducers.map(coproducer => ({
              key: coproducer.id,
              cells: [
                <div className={styles.primaryCell} key="coproducer"><strong>{coproducer.name}</strong><small>{coproducer.offer_id ? `Oferta: ${offerNames.get(coproducer.offer_id) || "Específica"}` : `Produto inteiro · ${coproducer.participation_bps / 100}%`}</small></div>,
                number(coproducer.sales_count),
                formatCents(coproducer.total_sales_cents),
                <strong key="participation">{formatCents(coproducer.participation_cents)}</strong>,
              ],
            }))}
          />
        </div>
      </>}
    </section>
  </div>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className={styles.fact}><small>{label}</small><strong>{value}</strong></div>;
}

function Kpi({ icon, label, value, hint, accent = false }: { icon: React.ReactNode; label: string; value: string; hint: string; accent?: boolean }) {
  return <article className={`${styles.kpi} ${accent ? styles.kpiAccent : ""}`}>
    <span>{icon}</span><div><small>{label}</small><strong>{value}</strong><p>{hint}</p></div>
  </article>;
}

function PaymentRow({ label, icon, count, amount, ratio }: { label: string; icon: React.ReactNode; count: number; amount: number; ratio: number }) {
  return <div className={styles.paymentRow}>
    <div className={styles.paymentLine}><span>{icon}<strong>{label}</strong></span><span><strong>{count}</strong><small>{formatCents(amount)}</small></span></div>
    <div className={styles.progress}><i style={{ width: `${ratio}%` }}/></div>
    <small>{ratio}% das vendas identificadas</small>
  </div>;
}

type TableRow = { key: string; cells: React.ReactNode[] };
function ReportTable({ eyebrow, title, description, columns, rows, empty, compact = false }: {
  eyebrow: string;
  title: string;
  description: string;
  columns: string[];
  rows: TableRow[];
  empty: string;
  compact?: boolean;
}) {
  return <section className={`${styles.tableSection} ${compact ? styles.compactTable : ""}`}>
    <div className={styles.tableHeading}><span>{eyebrow}</span><h3>{title}</h3><p>{description}</p></div>
    {!rows.length ? <Empty text={empty}/> : <div className={styles.tableWrap}><div className={styles.reportTable} role="table">
      <div className={styles.tableHead} role="row">{columns.map(column => <span role="columnheader" key={column}>{column}</span>)}</div>
      {rows.map(row => <div className={styles.tableRow} role="row" key={row.key}>{row.cells.map((cell, index) => <div role="cell" data-label={columns[index]} key={index}>{cell}</div>)}</div>)}
    </div></div>}
  </section>;
}

function Empty({ text }: { text: string }) {
  return <div className={styles.empty}>{text}</div>;
}
