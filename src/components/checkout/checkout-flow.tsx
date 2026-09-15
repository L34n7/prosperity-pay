"use client";
import Image from "next/image";
import { FormEvent, useRef, useState } from "react";
import { CreditCard, LockKeyhole, QrCode, ShieldCheck } from "lucide-react";
import { Brand } from "@/components/ui/brand";
import { formatCents } from "@/lib/operational";
import styles from "./checkout-payment-methods.module.css";

type PaymentMethod = "card" | "pix";

type Offer = {
  slug: string;
  name: string;
  productName: string;
  description: string | null;
  imageUrl: string | null;
  priceCents: number;
  firstChargeCents: number | null;
  billingType: string;
  billingInterval: string | null;
  billingIntervalCount: number | null;
  paymentCardEnabled: boolean;
  paymentPixEnabled: boolean;
  primaryPaymentMethod: PaymentMethod;
};

function recurrenceLabel(offer: Offer) {
  const count = Number(offer.billingIntervalCount ?? 1);
  if (offer.billingInterval === "week") return count === 1 ? "semanal" : `a cada ${count} semanas`;
  if (offer.billingInterval === "year") return count === 1 ? "anual" : `a cada ${count} anos`;
  if (offer.billingInterval === "month") {
    if (count === 1) return "mensal";
    if (count === 3) return "trimestral";
    if (count === 6) return "semestral";
    if (count === 12) return "anual";
    return `a cada ${count} meses`;
  }
  return "recorrente";
}

function initialPaymentMethod(offer: Offer): PaymentMethod {
  if (offer.primaryPaymentMethod === "card" && offer.paymentCardEnabled) return "card";
  if (offer.primaryPaymentMethod === "pix" && offer.paymentPixEnabled) return "pix";
  return offer.paymentCardEnabled ? "card" : "pix";
}

export function CheckoutFlow({ offer, affiliate }: { offer: Offer; affiliate?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(() => initialPaymentMethod(offer));
  const key = useRef<string | null>(null);
  const recurring = offer.billingType === "recurring";
  const initialPrice = recurring && offer.firstChargeCents ? offer.firstChargeCents : offer.priceCents;

  function choosePaymentMethod(method: PaymentMethod) {
    if (method === paymentMethod) return;
    setPaymentMethod(method);
    key.current = null;
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const data = new FormData(event.currentTarget);
    key.current ??= crypto.randomUUID();
    try {
      const response = await fetch("/api/checkout/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key.current },
        body: JSON.stringify({
          offerSlug: offer.slug,
          customerName: data.get("name"),
          customerEmail: data.get("email"),
          paymentMethod,
          refCode: affiliate,
        }),
      });
      const result = await response.json();
      if (response.status === 409) key.current = crypto.randomUUID();
      if (!response.ok || !result.checkoutUrl) throw new Error(result.error || "Não foi possível abrir o pagamento.");
      window.location.assign(result.checkoutUrl);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha no pagamento."); setBusy(false); }
  }

  const cardDescription = recurring
    ? "Renovação automática. O cartão cadastrado será cobrado a cada período."
    : "Pagamento com cartão de crédito.";
  const pixDescription = recurring
    ? "Paga somente este período. A próxima renovação deverá ser cobrada novamente."
    : "Pagamento à vista via PIX.";

  return <main className="checkout-page"><header className="checkout-header"><Brand href="/"/><span><LockKeyhole size={14}/> Ambiente seguro</span></header>
    <div className="checkout-layout"><section className="checkout-product">{offer.imageUrl && <Image className="checkout-product-image" src={offer.imageUrl} alt={offer.productName} width={640} height={360} unoptimized/>}<span className="checkout-badge">{offer.productName}</span><h1>{offer.name}</h1><p>{offer.description}</p><div className="security-note"><ShieldCheck size={22}/><div><strong>Pagamento protegido</strong><span>{recurring ? "No cartão, a renovação é automática. No PIX, cada período é pago separadamente." : "Você será redirecionado para o Mercado Pago."}</span></div></div></section>
    <section className="checkout-card"><div className="checkout-card-head"><div><span>{recurring ? "Resumo da assinatura" : "Resumo do pedido"}</span><h2>{offer.name}</h2></div><div className="checkout-price"><strong>{formatCents(initialPrice)}</strong>{recurring && <small>{offer.firstChargeCents && offer.firstChargeCents !== offer.priceCents ? ` na 1ª cobrança · depois ${formatCents(offer.priceCents)} ${recurrenceLabel(offer)}` : ` ${recurrenceLabel(offer)}`}</small>}</div></div>
    {affiliate && <div className="referral-note">Indicação aplicada</div>}
    <form onSubmit={submit} className="checkout-form"><div className="checkout-divider"><span>Dados do comprador</span></div><label>Nome completo<input name="name" required autoComplete="name"/></label><label>E-mail<input name="email" type="email" required autoComplete="email"/></label>
    <fieldset className={styles.methods}><legend>Forma de pagamento</legend>
      {offer.paymentCardEnabled && <label className={`${styles.method} ${paymentMethod === "card" ? styles.selected : ""}`}><input type="radio" name="payment-method" value="card" checked={paymentMethod === "card"} onChange={() => choosePaymentMethod("card")}/><CreditCard size={20}/><span><strong>Cartão de crédito</strong><small>{cardDescription}</small></span></label>}
      {offer.paymentPixEnabled && <label className={`${styles.method} ${paymentMethod === "pix" ? styles.selected : ""}`}><input type="radio" name="payment-method" value="pix" checked={paymentMethod === "pix"} onChange={() => choosePaymentMethod("pix")}/><QrCode size={20}/><span><strong>PIX</strong><small>{pixDescription}</small></span></label>}
    </fieldset>
    {recurring && paymentMethod === "card" && <p className="form-hint">Você será direcionado ao Mercado Pago para cadastrar o cartão. As próximas cobranças ocorrerão automaticamente conforme a frequência da assinatura. O e-mail informado acima é usado somente para identificar a compra no Prosperity Pay.</p>}
    {recurring && paymentMethod === "pix" && <p className="form-hint">O PIX quita somente o período atual e não cria cobrança automática. A próxima renovação dependerá de uma nova cobrança enviada pelo produtor.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="checkout-submit" disabled={busy}>{busy ? "Abrindo Mercado Pago..." : paymentMethod === "card" && recurring ? "Continuar com cartão →" : paymentMethod === "pix" ? "Continuar com PIX →" : "Continuar para pagamento →"}</button></form><footer className="checkout-card-footer"><LockKeyhole size={13}/> Pagamento processado pelo Mercado Pago</footer></section></div></main>;
}
