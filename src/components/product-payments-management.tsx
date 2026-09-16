"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CreditCard, Eye, Filter, ReceiptText, WalletCards, X } from "lucide-react";
import { requestJson } from "@/lib/operational";
import styles from "./product-payments-management.module.css";

type PaymentEvent = {
  id: string;
  transaction_type: string;
  status: string | null;
  occurred_at: string | null;
  created_at: string;
};

type ProductPayment = {
  id: string;
  order_id: string;
  offer_id: string;
  offer_name: string;
  customer_name: string | null;
  customer_email: string;
  customer_phone: string | null;
  amount_cents: number;
  status: string;
  order_status: string;
  settlement_model: string;
  created_at: string;
  paid_at: string | null;
  external_payment_id: string | null;
  external_reference: string;
  provider_fee_amount_cents: number;
  allowed_methods: { card: boolean; pix: boolean; primary: "card" | "pix" };
  actual_method: "card" | "pix" | "other";
  provider_method_id: string | null;
  payment_type_id: string | null;
  status_detail: string | null;
  installments: number | null;
  card_last_four: string | null;
  provider_created_at: string | null;
  provider_approved_at: string | null;
  financial: {
    gateway_fee_amount_cents: number;
    prosperity_fee_amount_cents: number;
    affiliate_amount_cents: number;
    coproducer_amount_cents: number;
    producer_amount_cents: number;
  } | null;
  events: PaymentEvent[];
};

type OfferOption = { id: string; name: string };

type ApiResponse = { offers: OfferOption[]; payments: ProductPayment[] };

const statusLabels: Record<string, string> = {
  pending: "Pendente",
  processing: "Processando",
  approved: "Aprovado",
  rejected: "Recusado",
  cancelled: "Cancelado",
  refunded: "Reembolsado",
  charged_back: "Chargeback",
};

function money(cents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(cents || 0) / 100);
}

function dateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function methodLabel(value: ProductPayment["actual_method"]) {
  if (value === "card") return "Cartão";
  if (value === "pix") return "PIX";
  return "Não identificado";
}

function allowedMethods(payment: ProductPayment) {
  const values: string[] = [];
  if (payment.allowed_methods.card) values.push("Cartão");
  if (payment.allowed_methods.pix) values.push("PIX");
  return values.length ? values.join(" + ") : "—";
}

function Status({ value }: { value: string }) {
  const tone = value === "approved" ? styles.statusApproved : value === "pending" || value === "processing" ? styles.statusPending : styles.statusNeutral;
  return <span className={`${styles.status} ${tone}`}>{statusLabels[value] ?? value}</span>;
}

export function ProductPaymentsManagement({ id }: { id: string }) {
  const [offers, setOffers] = useState<OfferOption[]>([]);
  const [payments, setPayments] = useState<ProductPayment[]>([]);
  const [offerId, setOfferId] = useState("");
  const [selected, setSelected] = useState<ProductPayment | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await requestJson<ApiResponse>(`/api/products/${id}/payments`);
      setOffers(data.offers ?? []);
      setPayments(data.payments ?? []);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao carregar pagamentos.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => payments.filter(payment => !offerId || payment.offer_id === offerId), [payments, offerId]);
  const approved = filtered.filter(payment => payment.status === "approved");
  const approvedTotal = approved.reduce((sum, payment) => sum + payment.amount_cents, 0);

  return <div className={styles.shell}>
    <section className={styles.hero}>
      <div className={styles.heroLead}>
        <span className={styles.heroIcon}><ReceiptText size={19}/></span>
        <div><small>Financeiro</small><h2>Pagamentos do produto</h2><p>Acompanhe cada pagamento gerado pelas ofertas deste produto.</p></div>
      </div>
      <div className={styles.metrics}>
        <div><small>Gerados</small><strong>{filtered.length}</strong></div>
        <div><small>Aprovados</small><strong>{approved.length}</strong></div>
        <div><small>Volume aprovado</small><strong>{money(approvedTotal)}</strong></div>
      </div>
    </section>

    {error && <p className={styles.error} role="alert">{error}</p>}

    <section className={styles.card}>
      <div className={styles.toolbar}>
        <div><h3>Histórico de pagamentos</h3><p>Os registros mais recentes aparecem primeiro.</p></div>
        <label className={styles.filter}><Filter size={15}/><span>Oferta</span><select value={offerId} onChange={event => setOfferId(event.target.value)}><option value="">Todas as ofertas</option>{offers.map(offer => <option value={offer.id} key={offer.id}>{offer.name}</option>)}</select></label>
      </div>

      {loading ? <div className={styles.empty}>Carregando pagamentos...</div> : filtered.length ? <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>Oferta</th><th>Cliente</th><th>Valor</th><th>Meios da oferta</th><th>Gerado em</th><th>Status</th><th/></tr></thead>
          <tbody>{filtered.map(payment => <tr key={payment.id}>
            <td><strong>{payment.offer_name}</strong><small>Pedido {payment.order_id.slice(0, 8)}</small></td>
            <td><strong>{payment.customer_name || "Cliente"}</strong><small>{payment.customer_email}</small></td>
            <td className={styles.amount}>{money(payment.amount_cents)}</td>
            <td><span className={styles.methods}>{allowedMethods(payment)}</span></td>
            <td><span>{dateTime(payment.created_at)}</span></td>
            <td><Status value={payment.status}/></td>
            <td><button type="button" className={styles.detailButton} onClick={() => setSelected(payment)}><Eye size={14}/>Detalhes</button></td>
          </tr>)}</tbody>
        </table>
      </div> : <div className={styles.empty}>Nenhum pagamento encontrado para esta seleção.</div>}
    </section>

    {selected && <div className={styles.overlay} onMouseDown={event => { if (event.target === event.currentTarget) setSelected(null); }}>
      <section className={styles.modal} role="dialog" aria-modal="true" aria-label="Detalhes do pagamento">
        <header className={styles.modalHeader}><div><small>Pagamento</small><h3>{selected.offer_name}</h3><p>{selected.customer_email}</p></div><button type="button" className={styles.close} onClick={() => setSelected(null)} aria-label="Fechar"><X size={18}/></button></header>
        <div className={styles.modalBody}>
          <div className={styles.summaryGrid}>
            <div><small>Valor</small><strong>{money(selected.amount_cents)}</strong></div>
            <div><small>Status</small><Status value={selected.status}/></div>
            <div><small>Método usado</small><strong>{methodLabel(selected.actual_method)}</strong></div>
            <div><small>Gerado em</small><strong>{dateTime(selected.created_at)}</strong></div>
          </div>

          <section className={styles.detailSection}><h4>Cliente</h4><dl>
            <div><dt>Nome</dt><dd>{selected.customer_name || "—"}</dd></div>
            <div><dt>E-mail</dt><dd>{selected.customer_email}</dd></div>
            <div><dt>Telefone</dt><dd>{selected.customer_phone || "—"}</dd></div>
          </dl></section>

          <section className={styles.detailSection}><h4>Cobrança</h4><dl>
            <div><dt>Oferta</dt><dd>{selected.offer_name}</dd></div>
            <div><dt>Meios permitidos</dt><dd>{allowedMethods(selected)}</dd></div>
            <div><dt>Método principal</dt><dd>{selected.allowed_methods.primary === "pix" ? "PIX" : "Cartão"}</dd></div>
            <div><dt>Método utilizado</dt><dd>{methodLabel(selected.actual_method)}{selected.provider_method_id ? ` · ${selected.provider_method_id}` : ""}</dd></div>
            <div><dt>Parcelas</dt><dd>{selected.installments ? `${selected.installments}x` : "—"}</dd></div>
            <div><dt>Final do cartão</dt><dd>{selected.card_last_four || "—"}</dd></div>
            <div><dt>Pago em</dt><dd>{dateTime(selected.paid_at || selected.provider_approved_at)}</dd></div>
          </dl></section>

          <section className={styles.detailSection}><h4>Financeiro</h4><dl>
            <div><dt>Valor bruto</dt><dd>{money(selected.amount_cents)}</dd></div>
            <div><dt>Taxa do gateway</dt><dd>{money(selected.provider_fee_amount_cents)}</dd></div>
            <div><dt>Taxa Prosperity</dt><dd>{selected.financial ? money(selected.financial.prosperity_fee_amount_cents) : "—"}</dd></div>
            <div><dt>Comissão afiliado</dt><dd>{selected.financial ? money(selected.financial.affiliate_amount_cents) : "—"}</dd></div>
            <div><dt>Coprodução</dt><dd>{selected.financial ? money(selected.financial.coproducer_amount_cents) : "—"}</dd></div>
            <div><dt>Produtor</dt><dd>{selected.financial ? money(selected.financial.producer_amount_cents) : "—"}</dd></div>
          </dl></section>

          <section className={styles.detailSection}><h4>Identificadores</h4><dl>
            <div><dt>Pagamento</dt><dd>{selected.external_payment_id || "Pendente"}</dd></div>
            <div><dt>Referência</dt><dd>{selected.external_reference}</dd></div>
            <div><dt>Pedido</dt><dd>{selected.order_id}</dd></div>
            <div><dt>Modelo</dt><dd>{selected.settlement_model === "connected_account" ? "Mercado Pago conectado" : "Saldo Prosperity"}</dd></div>
            <div><dt>Detalhe do status</dt><dd>{selected.status_detail || "—"}</dd></div>
          </dl></section>

          <section className={styles.detailSection}><h4>Eventos</h4>{selected.events.length ? <div className={styles.events}>{selected.events.map(event => <div key={event.id}><span/><div><strong>{event.transaction_type}</strong><small>{statusLabels[event.status ?? ""] ?? event.status ?? "Evento"} · {dateTime(event.occurred_at ?? event.created_at)}</small></div></div>)}</div> : <p className={styles.noEvents}>Nenhum evento adicional registrado.</p>}</section>
        </div>
        <footer className={styles.modalFooter}><button type="button" onClick={() => setSelected(null)}>Fechar</button></footer>
      </section>
    </div>}
  </div>;
}
