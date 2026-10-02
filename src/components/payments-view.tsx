"use client";

import { useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatCents, formatDate } from "@/lib/operational";
import type { PaymentStatus } from "@/lib/payments";
import { mercadoPagoPaymentMetadata } from "@/lib/payments/mercado-pago-payment-metadata";

type Order = {
  id: string;
  product_id: string;
  offer_id: string;
  customer_id: string;
  status: string;
  settlement_model: string;
  created_at: string;
  paid_at: string | null;
  products: { name: string } | null;
  offers: { name: string } | null;
  customers: { name: string | null; email: string } | null;
  financial_snapshots: {
    prosperity_fee_amount_cents: number;
    affiliate_amount_cents: number;
    coproducer_amount_cents: number;
    producer_amount_cents: number;
  } | null;
  affiliate_partner_type: "affiliate" | "accredited" | null;
  affiliate_commission_cents: number;
  accredited_commission_cents: number;
  coproducer_commission_cents: number;
  producer_net_cents: number | null;
};

type Payment = {
  id: string;
  order_id: string;
  status: string;
  external_payment_id: string | null;
  external_reference: string;
  gross_amount_cents: number;
  provider_fee_amount_cents: number;
  created_at: string;
  paid_at: string | null;
  raw_provider_data: unknown;
  payment_transactions: {
    transaction_type: string;
    status: string | null;
    occurred_at: string | null;
    created_at: string;
  }[];
};

function methodOf(payment: Payment) {
  const method = mercadoPagoPaymentMetadata(payment.raw_provider_data).method;
  return method === "pix" ? "PIX" : method === "card" ? "Cartão" : "—";
}

function metadataText(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

function planOf(payment: Payment, order: Order | undefined) {
  return metadataText(payment.raw_provider_data, "plan_label") ?? order?.offers?.name ?? "Plano não identificado";
}

function saleDateOf(payment: Payment, order: Order | undefined) {
  return payment.paid_at ?? order?.paid_at ?? payment.created_at;
}

function generatedDateOf(payment: Payment, order: Order | undefined) {
  return payment.created_at ?? order?.created_at ?? null;
}

function paymentDateOf(payment: Payment, order: Order | undefined) {
  return payment.paid_at ?? order?.paid_at ?? null;
}

function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

export function PaymentsView({
  orders,
  payments,
}: {
  orders: Order[];
  payments: Payment[];
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState("");
  const [cutoff, setCutoff] = useState(0);
  const [status, setStatus] = useState("");
  const [product, setProduct] = useState("");
  const [offer, setOffer] = useState("");
  const [method, setMethod] = useState("");
  const [model, setModel] = useState("");
  const [sortKey, setSortKey] = useState("generated");
  const [sortDirection, setSortDirection] = useState<1 | -1>(-1);

  const orderMap = new Map(orders.map((order) => [order.id, order]));
  const chosen = payments.find((payment) => payment.id === selected);
  const detail = chosen ? orderMap.get(chosen.order_id) : undefined;

  const normalizedSearch = normalizeSearch(search);

  const filtered = payments.filter((payment) => {
    const order = orderMap.get(payment.order_id);
    const saleDate = new Date(saleDateOf(payment, order)).getTime();
    const generatedDate = generatedDateOf(payment, order);
    const paymentDate = paymentDateOf(payment, order);
    const searchableText = normalizeSearch(
      [
        order?.customers?.name ?? "",
        order?.customers?.email ?? "",
        planOf(payment, order),
        order?.products?.name ?? "",
        formatCents(payment.gross_amount_cents),
        String(Number(payment.gross_amount_cents) / 100).replace(".", ","),
        generatedDate ? formatDate(generatedDate) : "",
        paymentDate ? formatDate(paymentDate) : "",
      ].join(" "),
    );

    return (
      (!normalizedSearch || searchableText.includes(normalizedSearch)) &&
      (!status || payment.status === status) &&
      (!product || order?.product_id === product) &&
      (!offer || order?.offer_id === offer) &&
      (!model || order?.settlement_model === model) &&
      (!method || methodOf(payment) === method) &&
      (!period || saleDate >= cutoff)
    );
  });

  function changeSort(key: string) {
    if (sortKey === key) {
      setSortDirection((current) => (current === 1 ? -1 : 1));
      return;
    }
    setSortKey(key);
    setSortDirection(["buyer", "plan", "method", "status"].includes(key) ? 1 : -1);
  }

  function sortMark(key: string) {
    if (sortKey !== key) return "↕";
    return sortDirection === 1 ? "↑" : "↓";
  }

  const list = [...filtered].sort((a, b) => {
    const orderA = orderMap.get(a.order_id);
    const orderB = orderMap.get(b.order_id);
    let comparison = 0;

    if (sortKey === "buyer") {
      comparison = (orderA?.customers?.name || orderA?.customers?.email || "").localeCompare(
        orderB?.customers?.name || orderB?.customers?.email || "",
        "pt-BR",
      );
    } else if (sortKey === "plan") {
      comparison = planOf(a, orderA).localeCompare(planOf(b, orderB), "pt-BR");
    } else if (sortKey === "method") {
      comparison = methodOf(a).localeCompare(methodOf(b), "pt-BR");
    } else if (sortKey === "status") {
      comparison = a.status.localeCompare(b.status, "pt-BR");
    } else if (sortKey === "value") {
      comparison = Number(a.gross_amount_cents) - Number(b.gross_amount_cents);
    } else if (sortKey === "received") {
      comparison =
        Number(orderA?.producer_net_cents ?? -1) -
        Number(orderB?.producer_net_cents ?? -1);
    } else if (sortKey === "paid") {
      comparison =
        new Date(paymentDateOf(a, orderA) || 0).getTime() -
        new Date(paymentDateOf(b, orderB) || 0).getTime();
    } else {
      comparison =
        new Date(generatedDateOf(a, orderA) || 0).getTime() -
        new Date(generatedDateOf(b, orderB) || 0).getTime();
    }

    return comparison * sortDirection;
  });

  const net = detail?.producer_net_cents ?? (
    detail?.financial_snapshots
      ? Number(detail.financial_snapshots.producer_amount_cents) -
        (detail.settlement_model === "prosperity_balance"
          ? Number(chosen?.provider_fee_amount_cents ?? 0)
          : 0)
      : 0
  );

  return (
    <>
      <PageHeader
        title="Pagamentos"
        description="Transações dos seus produtos, com comprador, e-mail e plano."
      />

      <section className="panel operational-panel">
        <label className="payment-search">
          <span>Buscar pagamentos</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por nome, e-mail, plano, valor ou data..."
            autoComplete="off"
          />
        </label>

        <div className="filter-row payment-filters">
          <label>
            Período
            <select
              value={period}
              onChange={(event) => {
                setPeriod(event.target.value);
                setCutoff(
                  event.target.value
                    ? Date.now() - Number(event.target.value) * 86400000
                    : 0,
                );
              }}
            >
              <option value="">Todos</option>
              <option value="7">7 dias</option>
              <option value="30">30 dias</option>
              <option value="90">90 dias</option>
            </select>
          </label>

          <label>
            Status
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">Todos</option>
              <option value="pending">Pendente</option>
              <option value="processing">Em processamento</option>
              <option value="approved">Aprovado</option>
              <option value="rejected">Recusado</option>
              <option value="cancelled">Cancelado</option>
              <option value="refunded">Estornado</option>
              <option value="charged_back">Contestado</option>
            </select>
          </label>

          <label>
            Produto
            <select value={product} onChange={(event) => setProduct(event.target.value)}>
              <option value="">Todos</option>
              {[
                ...new Map(
                  orders.map((order) => [order.product_id, order.products?.name]),
                ).entries(),
              ].map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Plano / oferta
            <select value={offer} onChange={(event) => setOffer(event.target.value)}>
              <option value="">Todos</option>
              {[
                ...new Map(
                  orders
                    .filter((order) => !product || order.product_id === product)
                    .map((order) => [order.offer_id, order.offers?.name]),
                ).entries(),
              ].map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Método
            <select value={method} onChange={(event) => setMethod(event.target.value)}>
              <option value="">Todos</option>
              {[...new Set(payments.map(methodOf).filter((item) => item !== "—"))].map(
                (item) => (
                  <option key={item}>{item}</option>
                ),
              )}
            </select>
          </label>

          <label>
            Recebimento
            <select value={model} onChange={(event) => setModel(event.target.value)}>
              <option value="">Todos</option>
              <option value="connected_account">Mercado Pago</option>
              <option value="prosperity_balance">Saldo Prosperity</option>
            </select>
          </label>
        </div>

        {list.length ? (
          <div className="payment-report-table-wrap">
            <table className="payment-report-table">
              <thead>
                <tr>
                  <th><button type="button" className="payment-sort-button" onClick={() => changeSort("buyer")}>Comprador <span>{sortMark("buyer")}</span></button></th>
                  <th><button type="button" className="payment-sort-button" onClick={() => changeSort("plan")}>Plano / produto <span>{sortMark("plan")}</span></button></th>
                  <th><button type="button" className="payment-sort-button" onClick={() => changeSort("method")}>Método <span>{sortMark("method")}</span></button></th>
                  <th><button type="button" className="payment-sort-button" onClick={() => changeSort("status")}>Status <span>{sortMark("status")}</span></button></th>
                  <th><button type="button" className="payment-sort-button" onClick={() => changeSort("value")}>Valor <span>{sortMark("value")}</span></button></th>
                  <th><button type="button" className="payment-sort-button" onClick={() => changeSort("received")}>Recebido <span>{sortMark("received")}</span></button></th>
                  <th><button type="button" className="payment-sort-button" onClick={() => changeSort("generated")}>Data <span>{sortMark("generated")}</span></button></th>
                  <th><button type="button" className="payment-sort-button" onClick={() => changeSort("paid")}>Data do pagamento <span>{sortMark("paid")}</span></button></th>
                  <th aria-label="Abrir detalhes" />
                </tr>
              </thead>
              <tbody>
                {list.map((payment) => {
                  const order = orderMap.get(payment.order_id);
                  const customer = order?.customers;
                  const plan = planOf(payment, order);
                  const paymentMethod = methodOf(payment);

                  return (
                    <tr
                      key={payment.id}
                      className="payment-report-clickable"
                      onClick={() => setSelected(payment.id)}
                    >
                      <td>
                        <strong>{customer?.name || "Comprador"}</strong>
                        <span>{customer?.email || "E-mail não informado"}</span>
                      </td>
                      <td>
                        <strong>{plan}</strong>
                        <span>{order?.products?.name ?? "Produto"}</span>
                      </td>
                      <td>
                        <span className={"payment-method-pill " + (paymentMethod === "PIX" ? "is-pix" : paymentMethod === "Cartão" ? "is-card" : "")}>
                          {paymentMethod}
                        </span>
                      </td>
                      <td>
                        <StatusBadge status={payment.status as PaymentStatus} />
                      </td>
                      <td className="payment-value">{formatCents(payment.gross_amount_cents)}</td>
                      <td className="payment-value">
                        {order?.producer_net_cents == null ? "—" : formatCents(order.producer_net_cents)}
                      </td>
                      <td className="payment-date">{generatedDateOf(payment, order) ? formatDate(generatedDateOf(payment, order)!) : "—"}</td>
                      <td className="payment-date">{paymentDateOf(payment, order) ? formatDate(paymentDateOf(payment, order)!) : "—"}</td>
                      <td className="payment-open-cell">
                        <span aria-hidden="true">→</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="premium-report-empty">Nenhum pagamento encontrado.</div>
        )}
      </section>

      {chosen && detail && (
        <div className="detail-overlay" onClick={() => setSelected(null)}>
          <aside
            className="detail-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Detalhes do pagamento"
            onClick={(event) => event.stopPropagation()}
          >
            <button className="secondary-button" onClick={() => setSelected(null)}>
              Fechar
            </button>

            <h2>Pagamento</h2>

            <p>
              {detail.customers?.name || "Comprador"} ·{" "}
              {detail.customers?.email || "E-mail não informado"}
            </p>
            <p>
              {detail.products?.name} · {planOf(chosen, detail)}
            </p>

            <dl>
              {[
                ["Comprador", detail.customers?.name || "—"],
                ["E-mail", detail.customers?.email || "—"],
                ["Plano", planOf(chosen, detail)],
                ["Data", generatedDateOf(chosen, detail) ? formatDate(generatedDateOf(chosen, detail)!) : "—"],
                ["Data do pagamento", paymentDateOf(chosen, detail) ? formatDate(paymentDateOf(chosen, detail)!) : "—"],
                ["Bruto", formatCents(chosen.gross_amount_cents)],
                ["Taxa gateway apurada", formatCents(chosen.provider_fee_amount_cents)],
                [
                  "Taxa Prosperity",
                  formatCents(detail.financial_snapshots?.prosperity_fee_amount_cents),
                ],
                [
                  "Afiliado",
                  formatCents(detail.affiliate_commission_cents),
                ],
                [
                  "Credenciado",
                  formatCents(detail.accredited_commission_cents),
                ],
                [
                  "Coprodutor",
                  formatCents(
                    detail.coproducer_commission_cents ||
                      detail.financial_snapshots?.coproducer_amount_cents,
                  ),
                ],
                ["Recebido pelo produtor", formatCents(net)],
                ["Método", methodOf(chosen)],
                ["Modelo", detail.settlement_model],
                ["Payment ID", chosen.external_payment_id ?? "Pendente"],
                ["Referência", chosen.external_reference],
                ["Status", chosen.status],
              ].map(([key, value]) => (
                <div className="record-row" key={key}>
                  <dt>{key}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>

            <h3>Eventos</h3>
            {chosen.payment_transactions.length ? (
              chosen.payment_transactions.map((event, index) => (
                <p key={index}>
                  {formatDate(event.occurred_at ?? event.created_at)} ·{" "}
                  {event.transaction_type} · {event.status}
                </p>
              ))
            ) : (
              <p>Aguardando eventos do processador.</p>
            )}
          </aside>
        </div>
      )}
    </>
  );
}
