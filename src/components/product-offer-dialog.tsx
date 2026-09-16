"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { CreditCard, QrCode, X } from "lucide-react";
import { checkoutReference } from "@/lib/domain/offer-reference";
import { AFFILIATE_HOLD_DAYS, getInstallmentOptions } from "@/lib/domain/offer-rules";
import type { ProductPaymentType } from "@/lib/domain/product-rules";
import styles from "./product-offer-dialog.module.css";

type Product = {
  payment_type: ProductPaymentType;
  settlement_model: string;
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
  first_charge_cents: number | null;
};

type Props = {
  product: Product;
  offer: Offer | null;
  busy: boolean;
  onClose: () => void;
  onSave: (payload: object) => Promise<void>;
};

function moneyInput(cents: number | null | undefined) {
  return cents == null ? "" : (cents / 100).toFixed(2);
}

function cents(value: FormDataEntryValue | null) {
  return Math.round(Number(value) * 100);
}

function productPrice(product: Product) {
  return product.payment_type === "recurring" ? product.recurring_price_cents : product.main_offer_price_cents;
}

function Switch({ checked, disabled, onChange, label }: { checked: boolean; disabled?: boolean; onChange: (value: boolean) => void; label: string }) {
  return <button
    type="button"
    className={`${styles.switch} ${checked ? styles.switchOn : ""}`}
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
  ><span/></button>;
}

export function ProductOfferDialog({ product, offer, busy, onClose, onSave }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const affiliateOptionsRef = useRef<HTMLDivElement>(null);
  const defaultPrice = offer?.price_cents ?? productPrice(product) ?? 0;
  const [price, setPrice] = useState(moneyInput(defaultPrice));
  const [active, setActive] = useState(offer?.status === "active");
  const [cardEnabled, setCardEnabled] = useState(offer?.payment_card_enabled ?? true);
  const [pixEnabled, setPixEnabled] = useState(offer?.payment_pix_enabled ?? true);
  const [primary, setPrimary] = useState<"card" | "pix">(offer?.primary_payment_method ?? "card");
  const connectedRecurring = product.payment_type === "recurring" && product.settlement_model === "connected_account";
  const [affiliateEnabled, setAffiliateEnabled] = useState(connectedRecurring ? false : offer?.affiliate_enabled ?? false);
  const allowedInstallments = getInstallmentOptions(Math.round(Number(price || 0) * 100));
  const allowedMaximum = allowedInstallments[allowedInstallments.length - 1] ?? 1;
  const [maxInstallments, setMaxInstallments] = useState(Math.min(offer?.max_installments ?? allowedMaximum, allowedMaximum));

  useEffect(() => { ref.current?.showModal(); }, []);
  useEffect(() => {
    if (!affiliateEnabled || connectedRecurring) return;
    requestAnimationFrame(() => affiliateOptionsRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  }, [affiliateEnabled, connectedRecurring]);

  function changeCard(enabled: boolean) {
    setCardEnabled(enabled);
    if (!enabled) {
      setMaxInstallments(1);
      if (primary === "card" && pixEnabled) setPrimary("pix");
    } else if (!pixEnabled && primary === "pix") setPrimary("card");
  }

  function changePix(enabled: boolean) {
    setPixEnabled(enabled);
    if (!enabled && primary === "pix" && cardEnabled) setPrimary("card");
    else if (enabled && !cardEnabled && primary === "card") setPrimary("pix");
  }

  function changePrice(value: string) {
    setPrice(value);
    const nextOptions = getInstallmentOptions(Math.round(Number(value || 0) * 100));
    const nextMax = nextOptions[nextOptions.length - 1] ?? 1;
    setMaxInstallments(current => Math.min(current, nextMax));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await onSave({
      name: data.get("name"),
      priceCents: cents(data.get("price")),
      paymentCardEnabled: cardEnabled,
      paymentPixEnabled: pixEnabled,
      primaryPaymentMethod: primary,
      maxInstallments: product.payment_type === "recurring" ? 1 : cardEnabled ? maxInstallments : 1,
      firstChargeCents: product.payment_type === "recurring" && product.different_first_charge ? cents(data.get("firstCharge")) : null,
      active,
      affiliateEnabled: connectedRecurring ? false : affiliateEnabled,
      affiliateCommissionBps: !connectedRecurring && affiliateEnabled
        ? Math.round(Number(data.get("commission") || 0) * 100)
        : (offer?.affiliate_commission_bps ?? 0),
    });
  }

  const reference = offer ? checkoutReference(offer.checkout_slug) : null;

  return <dialog ref={ref} className={styles.dialog} onClose={onClose} onCancel={event => { if (busy) event.preventDefault(); }}>
    <form className={styles.form} onSubmit={submit}>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <span>{offer ? "Editar oferta" : "Nova oferta"}</span>
          <h2>{offer ? offer.name : "Criar oferta"}</h2>
        </div>
        <div className={styles.headerActions}>
          <label className={styles.headerSwitch}>
            <span><strong>Oferta ativa</strong><small>{active ? "Checkout liberado" : "Checkout indisponível"}</small></span>
            <Switch checked={active} onChange={setActive} label="Alterar status da oferta"/>
          </label>
          <button type="button" className={styles.closeButton} disabled={busy} onClick={() => ref.current?.close()} aria-label="Fechar"><X size={18}/></button>
        </div>
      </header>

      <div className={styles.body}>
        <section className={styles.block}>
          <div className={styles.blockTitle}><h3>Oferta</h3>{reference && <code>{reference}</code>}</div>
          <div className={styles.gridTwo}>
            <label className={styles.field}><span>Nome</span><input name="name" defaultValue={offer?.name ?? "Oferta principal"} required minLength={2}/></label>
            <label className={styles.field}>
              <span>{product.payment_type === "recurring" ? "Valor da recorrência" : "Preço"}</span>
              <div className={styles.moneyInput}><small>R$</small><input name="price" type="number" min="0.01" step="0.01" value={price} onChange={event => changePrice(event.target.value)} required/></div>
            </label>
          </div>
        </section>

        <section className={styles.block}>
          <div className={styles.blockTitle}><h3>Pagamento</h3><small>{product.payment_type === "recurring" ? "Assinatura recorrente" : "Pagamento único"}</small></div>
          <div className={styles.paymentRow}>
            <button type="button" className={`${styles.paymentOption} ${cardEnabled ? styles.paymentOn : ""}`} onClick={() => changeCard(!cardEnabled)}><CreditCard size={17}/><span>Cartão</span><small>{cardEnabled ? "Ativo" : "Inativo"}</small></button>
            <button type="button" className={`${styles.paymentOption} ${pixEnabled ? styles.paymentOn : ""}`} onClick={() => changePix(!pixEnabled)}><QrCode size={17}/><span>PIX</span><small>{pixEnabled ? "Ativo" : "Inativo"}</small></button>
          </div>

          <div className={styles.gridTwo}>
            <label className={styles.field}>
              <span>Método principal</span>
              <select value={primary} onChange={event => setPrimary(event.target.value as "card" | "pix")}>
                {cardEnabled && <option value="card">Cartão</option>}
                {pixEnabled && <option value="pix">PIX</option>}
              </select>
            </label>
            {product.payment_type === "one_time" ? <label className={styles.field}>
              <span>Máximo de parcelas</span>
              <select value={maxInstallments} disabled={!cardEnabled} onChange={event => setMaxInstallments(Number(event.target.value))}>{allowedInstallments.map(value => <option value={value} key={value}>{value}x</option>)}</select>
              <small>Parcela mínima de R$ 50, limitada a 12x.</small>
            </label> : product.different_first_charge ? <label className={styles.field}>
              <span>Primeira cobrança</span>
              <div className={styles.moneyInput}><small>R$</small><input name="firstCharge" type="number" min="0.01" step="0.01" defaultValue={moneyInput(offer?.first_charge_cents ?? product.first_charge_cents)} required/></div>
            </label> : <div className={styles.simpleInfo}><span>Recorrência</span><strong>Sem parcelamento</strong></div>}
          </div>
        </section>

        <section className={styles.block}>
          <div className={styles.toggleLine}>
            <div><h3>Afiliados</h3><p>{connectedRecurring ? "Indisponível para recebimento recorrente direto no Mercado Pago." : "Permita que afiliados divulguem esta oferta e recebam comissão."}</p></div>
            <Switch checked={affiliateEnabled} disabled={connectedRecurring} onChange={setAffiliateEnabled} label="Disponibilidade para afiliados"/>
          </div>

          {!connectedRecurring && affiliateEnabled && <div ref={affiliateOptionsRef} className={styles.affiliateOptions}>
            <label className={styles.field}>
              <span>Comissão padrão</span>
              <div className={styles.percentInput}><input name="commission" type="number" min="0" max="100" step="0.01" defaultValue={(offer?.affiliate_commission_bps ?? 0) / 100}/><small>%</small></div>
            </label>
            <div className={styles.simpleInfo}><span>Liberação da comissão</span><strong>{AFFILIATE_HOLD_DAYS} dias após a venda</strong></div>
          </div>}
        </section>
      </div>

      <footer className={styles.footer}>
        <button type="button" className={styles.cancelButton} disabled={busy} onClick={() => ref.current?.close()}>Cancelar</button>
        <button className={styles.saveButton} disabled={busy || (!cardEnabled && !pixEnabled)}>{busy ? "Salvando..." : offer ? "Salvar alterações" : "Criar oferta"}</button>
      </footer>
    </form>
  </dialog>;
}
