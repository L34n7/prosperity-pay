"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  BadgeDollarSign,
  CreditCard,
  Layers3,
  QrCode,
  Tag,
  UsersRound,
  WalletCards,
  X,
} from "lucide-react";
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

  const paymentTypeLabel = product.payment_type === "recurring" ? "Assinatura recorrente" : "Pagamento único";
  const reference = offer ? checkoutReference(offer.checkout_slug) : null;

  return <dialog
    ref={ref}
    className={styles.dialog}
    onClose={onClose}
    onCancel={event => { if (busy) event.preventDefault(); }}
  >
    <form className={styles.form} onSubmit={submit}>
      <header className={styles.header}>
        <div className={styles.headerIdentity}>
          <div className={styles.headerIcon}><Tag size={20}/></div>
          <div>
            <span>{offer ? "Editar oferta" : "Nova oferta"}</span>
            <h2>{offer ? offer.name : "Criar oferta"}</h2>
            <p>Defina preço, cobrança, disponibilidade e regras comerciais.</p>
          </div>
        </div>
        <div className={styles.headerActions}>
          <div className={`${styles.statusControl} ${active ? styles.statusActive : ""}`}>
            <div><strong>{active ? "Oferta ativa" : "Oferta inativa"}</strong><small>{active ? "Checkout liberado" : "Checkout indisponível"}</small></div>
            <Switch checked={active} onChange={setActive} label="Alterar status da oferta"/>
          </div>
          <button type="button" className={styles.closeButton} disabled={busy} onClick={() => ref.current?.close()} aria-label="Fechar"><X size={18}/></button>
        </div>
      </header>

      <div className={styles.body}>
        <section className={styles.section}>
          <div className={styles.sectionHeading}>
            <span><BadgeDollarSign size={17}/></span>
            <div><h3>Dados da oferta</h3><p>Informações principais exibidas na gestão e utilizadas na cobrança.</p></div>
          </div>
          <div className={styles.twoColumns}>
            <label className={styles.field}>
              <span>Nome da oferta</span>
              <input name="name" defaultValue={offer?.name ?? "Oferta principal"} required minLength={2}/>
            </label>
            <label className={styles.field}>
              <span>{product.payment_type === "recurring" ? "Preço da recorrência" : "Preço da oferta"}</span>
              <div className={styles.moneyInput}><small>R$</small><input name="price" type="number" min="0.01" step="0.01" value={price} onChange={event => changePrice(event.target.value)} required/></div>
            </label>
          </div>
          <div className={styles.infoStrip}>
            <div><small>Modelo de cobrança</small><strong>{paymentTypeLabel}</strong></div>
            {reference && <div><small>Referência fixa</small><code>{reference}</code></div>}
            <div><small>Recebimento</small><strong>{product.settlement_model === "connected_account" ? "Direto no Mercado Pago" : "Saldo Prosperity Pay"}</strong></div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.sectionHeading}>
            <span><WalletCards size={17}/></span>
            <div><h3>Pagamento</h3><p>Escolha os meios aceitos e qual será sugerido primeiro no checkout.</p></div>
          </div>
          <div className={styles.paymentGrid}>
            <button type="button" className={`${styles.paymentCard} ${cardEnabled ? styles.paymentSelected : ""}`} onClick={() => changeCard(!cardEnabled)}>
              <span className={styles.paymentIcon}><CreditCard size={19}/></span>
              <span><strong>Cartão</strong><small>{cardEnabled ? "Habilitado" : "Desabilitado"}</small></span>
              <i>{cardEnabled ? "Ativo" : "Inativo"}</i>
            </button>
            <button type="button" className={`${styles.paymentCard} ${pixEnabled ? styles.paymentSelected : ""}`} onClick={() => changePix(!pixEnabled)}>
              <span className={styles.paymentIcon}><QrCode size={19}/></span>
              <span><strong>PIX</strong><small>{pixEnabled ? "Habilitado" : "Desabilitado"}</small></span>
              <i>{pixEnabled ? "Ativo" : "Inativo"}</i>
            </button>
          </div>

          {(cardEnabled || pixEnabled) && <div className={styles.primaryMethod}>
            <div><small>Método principal</small><strong>Forma de pagamento destacada primeiro</strong></div>
            <div className={styles.segmented}>
              <button type="button" disabled={!cardEnabled} className={primary === "card" ? styles.segmentActive : ""} onClick={() => setPrimary("card")}><CreditCard size={14}/> Cartão</button>
              <button type="button" disabled={!pixEnabled} className={primary === "pix" ? styles.segmentActive : ""} onClick={() => setPrimary("pix")}><QrCode size={14}/> PIX</button>
            </div>
          </div>}

          {product.payment_type === "recurring" && product.different_first_charge && <label className={styles.field}>
            <span>Valor da primeira cobrança</span>
            <div className={styles.moneyInput}><small>R$</small><input name="firstCharge" type="number" min="0.01" step="0.01" defaultValue={moneyInput(offer?.first_charge_cents ?? product.first_charge_cents)} required/></div>
          </label>}

          {product.payment_type === "recurring" ? <div className={styles.note}><Layers3 size={16}/><span><strong>Assinatura automática</strong>Não utiliza parcelamento. Para recorrência automática, mantenha Cartão habilitado.</span></div> : <label className={styles.field}>
            <span>Quantidade máxima de parcelas</span>
            <select value={maxInstallments} disabled={!cardEnabled} onChange={event => setMaxInstallments(Number(event.target.value))}>{allowedInstallments.map(value => <option value={value} key={value}>{value}x</option>)}</select>
            <small>Parcela mínima de R$ 50, limitada a 12x.</small>
          </label>}
        </section>

        <section className={`${styles.section} ${styles.partnerSection}`}>
          <div className={styles.sectionHeading}>
            <span><UsersRound size={17}/></span>
            <div><h3>Afiliados</h3><p>Controle se esta oferta pode gerar comissão para parceiros.</p></div>
          </div>
          <div className={`${styles.toggleCard} ${affiliateEnabled ? styles.toggleCardActive : ""} ${connectedRecurring ? styles.toggleCardDisabled : ""}`}>
            <div>
              <strong>Disponível para afiliados</strong>
              <small>{connectedRecurring ? "Indisponível neste modelo de recebimento recorrente." : affiliateEnabled ? "Afiliados podem divulgar e receber comissão desta oferta." : "A oferta não participa do programa de afiliados."}</small>
            </div>
            <Switch checked={affiliateEnabled} disabled={connectedRecurring} onChange={setAffiliateEnabled} label="Disponibilidade para afiliados"/>
          </div>

          {!connectedRecurring && affiliateEnabled && <div className={styles.affiliateGrid}>
            <label className={styles.field}>
              <span>Comissão padrão</span>
              <div className={styles.percentInput}><input name="commission" type="number" min="0" max="100" step="0.01" defaultValue={(offer?.affiliate_commission_bps ?? 0) / 100}/><small>%</small></div>
            </label>
            <div className={styles.holdCard}><small>Liberação da comissão</small><strong>{AFFILIATE_HOLD_DAYS} dias</strong><span>após a aprovação da venda</span></div>
          </div>}
        </section>
      </div>

      <footer className={styles.footer}>
        <div><span className={active ? styles.footerDotActive : styles.footerDot}/><p><strong>{active ? "Publicação ativa" : "Salva como inativa"}</strong><small>{active ? "O checkout ficará disponível após salvar." : "Você pode ativar esta oferta quando estiver pronta."}</small></p></div>
        <div className={styles.footerActions}>
          <button type="button" className={styles.cancelButton} disabled={busy} onClick={() => ref.current?.close()}>Cancelar</button>
          <button className={styles.saveButton} disabled={busy || (!cardEnabled && !pixEnabled)}>{busy ? "Salvando..." : offer ? "Salvar alterações" : "Criar oferta"}</button>
        </div>
      </footer>
    </form>
  </dialog>;
}
