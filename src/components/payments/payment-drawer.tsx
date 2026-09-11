"use client";

import { Copy, ExternalLink, X } from "lucide-react";
import type { Payment } from "@/lib/dashboard/types";
import { dateFormatter, moneyFormatter } from "@/lib/dashboard/formatters";
import { StatusBadge } from "@/components/ui/status-badge";
import { PaymentTimeline } from "./payment-timeline";

export function PaymentDrawer({ payment, onClose }: { payment: Payment | null; onClose: () => void }) {
  if (!payment) return null;

  const netRevenue = payment.amount - payment.providerFee - payment.commission;

  return (
    <div className="drawer-layer" role="presentation">
      <button className="drawer-backdrop" onClick={onClose} aria-label="Fechar detalhes do pagamento" />
      <aside className="payment-drawer" role="dialog" aria-modal="true" aria-labelledby="payment-drawer-title">
        <header className="drawer-header">
          <div><span>Detalhes do pagamento</span><h2 id="payment-drawer-title">{payment.id}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={20} /></button>
        </header>
        <div className="drawer-content">
          <div className="payment-highlight">
            <StatusBadge status={payment.status} />
            <strong>{moneyFormatter.format(payment.amount)}</strong>
            <span>{dateFormatter.format(new Date(payment.createdAt))}</span>
          </div>

          <section className="drawer-section">
            <h3>Informações</h3>
            <dl className="detail-list">
              <div><dt>Cliente</dt><dd>{payment.customer}<small>{payment.email}</small></dd></div>
              <div><dt>Método</dt><dd>{payment.method}</dd></div>
              <div><dt>Processador</dt><dd>{payment.provider}</dd></div>
              <div><dt>ID externo</dt><dd className="copyable">{payment.externalId}<Copy size={14} /></dd></div>
              <div><dt>Afiliado</dt><dd>{payment.affiliate ?? "Venda direta"}</dd></div>
            </dl>
          </section>

          <section className="drawer-section">
            <h3>Composição financeira</h3>
            <dl className="financial-breakdown">
              <div><dt>Valor bruto</dt><dd>{moneyFormatter.format(payment.amount)}</dd></div>
              <div><dt>Taxa do processador</dt><dd>- {moneyFormatter.format(payment.providerFee)}</dd></div>
              <div><dt>Comissão</dt><dd>- {moneyFormatter.format(payment.commission)}</dd></div>
              <div className="total"><dt>Receita líquida</dt><dd>{moneyFormatter.format(netRevenue)}</dd></div>
            </dl>
          </section>

          <section className="drawer-section">
            <h3>Linha do tempo</h3>
            <PaymentTimeline />
          </section>
        </div>
        <footer className="drawer-footer">
          <button className="secondary-button" onClick={onClose}>Fechar</button>
          <button className="primary-button">Ver registro completo <ExternalLink size={16} /></button>
        </footer>
      </aside>
    </div>
  );
}
