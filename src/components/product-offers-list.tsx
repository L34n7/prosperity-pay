"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Check,
  Copy,
  CreditCard,
  ExternalLink,
  Link2,
  Pencil,
  Plus,
  QrCode,
  ReceiptText,
  Tags,
  Trash2,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { checkoutPath, checkoutReference } from "@/lib/domain/offer-reference";
import { formatCents } from "@/lib/operational";
import styles from "./product-offers-list.module.css";

export type ProductOfferListItem = {
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
  first_charge_cents: number | null;
};

type Props = {
  paymentType: "one_time" | "recurring";
  offers: ProductOfferListItem[];
  onNew: () => void;
  onEdit: (offer: ProductOfferListItem) => void;
  onDelete: (offer: ProductOfferListItem) => void;
};

function statusLabel(status: string) {
  switch (status) {
    case "active": return "Ativa";
    case "inactive": return "Inativa";
    case "archived": return "Arquivada";
    default: return "Rascunho";
  }
}

function methodLabel(offer: ProductOfferListItem) {
  const methods = [offer.payment_card_enabled ? "Cartão" : null, offer.payment_pix_enabled ? "PIX" : null].filter(Boolean);
  return methods.join(" + ") || "Nenhum";
}

export function ProductOffersList({ paymentType, offers, onNew, onEdit, onDelete }: Props) {
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(key: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(key);
    window.setTimeout(() => setCopied(current => current === key ? null : current), 1400);
  }

  return <div className={styles.wrapper}>
    <div className={styles.heading}>
      <div>
        <span>Comercial</span>
        <h2>Ofertas</h2>
        <p>Gerencie preços, checkout, formas de pagamento e regras comerciais em uma visão detalhada.</p>
      </div>
      <div className={styles.headingActions}>
        <strong>{offers.length} {offers.length === 1 ? "oferta" : "ofertas"}</strong>
        <button className={styles.newButton} onClick={onNew}><Plus size={16}/> Nova oferta</button>
      </div>
    </div>

    {!offers.length ? <div className={styles.empty}>
      <Tags size={24}/>
      <div><strong>Nenhuma oferta cadastrada</strong><p>Crie a primeira oferta para disponibilizar um checkout deste produto.</p></div>
      <button onClick={onNew}><Plus size={15}/> Criar oferta</button>
    </div> : <div className={styles.list}>
      {offers.map(offer => {
        const reference = checkoutReference(offer.checkout_slug);
        const path = checkoutPath(offer.checkout_slug);
        const checkoutUrl = `https://prosperity-pay.vercel.app${path}`;
        const active = offer.status === "active";
        const referenceKey = `${offer.id}:reference`;
        const linkKey = `${offer.id}:link`;

        return <article className={styles.offerRow} key={offer.id}>
          <div className={styles.offerMain}>
            <div className={styles.offerIdentity}>
              <div className={styles.iconBox}><ReceiptText size={19}/></div>
              <div>
                <div className={styles.titleLine}>
                  <h3>{offer.name}</h3>
                  <span className={active ? styles.activeBadge : styles.mutedBadge}>{statusLabel(offer.status)}</span>
                </div>
                <p>{offer.billing_type === "recurring" ? "Oferta recorrente" : "Pagamento único"}</p>
                <div className={styles.priceBlock}>
                  <small>Preço</small>
                  <strong>{formatCents(offer.price_cents)}</strong>
                  {offer.first_charge_cents != null && <span>1ª cobrança {formatCents(offer.first_charge_cents)}</span>}
                </div>
              </div>
            </div>
          </div>

          <div className={styles.offerDetails}>
            <div className={styles.metrics}>
              <div><span><WalletCards size={15}/></span><small>Métodos</small><strong>{methodLabel(offer)}</strong></div>
              <div><span><UsersRound size={15}/></span><small>Afiliados</small><strong>{offer.affiliate_enabled ? `${offer.affiliate_commission_bps / 100}% de comissão` : "Desativado"}</strong></div>
              <div><span><CreditCard size={15}/></span><small>Parcelamento</small><strong>{paymentType === "recurring" ? "Assinatura" : `Até ${offer.max_installments}x`}</strong></div>
              <div><span>{offer.primary_payment_method === "pix" ? <QrCode size={15}/> : <CreditCard size={15}/>}</span><small>Principal</small><strong>{offer.primary_payment_method === "pix" ? "PIX" : "Cartão"}</strong></div>
            </div>

            <div className={styles.linkArea}>
              <div className={styles.checkoutField}>
                <small>Link de pagamento</small>
                <div>
                  <Link2 size={15}/>
                  <code>{checkoutUrl}</code>
                  <button aria-label="Copiar link de pagamento" onClick={() => void copy(linkKey, checkoutUrl)}>{copied === linkKey ? <Check size={15}/> : <Copy size={15}/>}</button>
                  <Link aria-label="Abrir checkout" href={path} target="_blank"><ExternalLink size={15}/></Link>
                </div>
              </div>
              <div className={styles.referenceField}>
                <small>Referência</small>
                <div><code>{reference}</code><button aria-label="Copiar referência" onClick={() => void copy(referenceKey, reference)}>{copied === referenceKey ? <Check size={15}/> : <Copy size={15}/>}</button></div>
              </div>
            </div>
          </div>

          <div className={styles.actions}>
            <button className={styles.editButton} onClick={() => onEdit(offer)}><Pencil size={15}/> Editar</button>
            <button className={styles.deleteButton} onClick={() => onDelete(offer)}><Trash2 size={15}/> Excluir</button>
          </div>
        </article>;
      })}
    </div>}
  </div>;
}
