"use client";

import Image from "next/image";
import Script from "next/script";
import { FormEvent, useEffect, useRef, useState } from "react";
import { Check, Copy, CreditCard, LockKeyhole, QrCode, ShieldCheck } from "lucide-react";
import { Brand } from "@/components/ui/brand";
import { formatCents } from "@/lib/operational";
import styles from "./transparent-checkout.module.css";

type PaymentMethod = "card" | "pix";

type Offer = {
  slug: string;
  productId: string;
  name: string;
  productName: string;
  imageUrl: string | null;
  priceCents: number;
  firstChargeCents: number | null;
  billingType: string;
  billingInterval: string | null;
  billingIntervalCount: number | null;
  maxInstallments: number;
  paymentCardEnabled: boolean;
  paymentPixEnabled: boolean;
};

type PriceCompositionLine = {
  label: string;
  amountCents: number;
  quantity?: number;
  type?: "base" | "addon" | "proration";
};

type CardFormData = {
  paymentMethodId?: string;
  issuerId?: string;
  cardholderEmail?: string;
  token?: string;
  installments?: string | number;
  identificationNumber?: string;
  identificationType?: string;
};

type CardFormInstance = {
  getCardFormData: () => CardFormData;
  unmount?: () => void;
};

type MercadoPagoInstance = {
  cardForm: (config: Record<string, unknown>) => CardFormInstance;
};

declare global {
  interface Window {
    MercadoPago?: new (publicKey: string, options?: { locale?: string }) => MercadoPagoInstance;
    MP_DEVICE_SESSION_ID?: string;
  }
}

type CheckoutResult = {
  orderId: string;
  status: string;
  providerOrderId?: string;
  qrCode?: string;
  qrCodeBase64?: string;
  ticketUrl?: string;
};

function recurrenceLabel(offer: Offer) {
  const count = Number(offer.billingIntervalCount ?? 1);
  if (offer.billingInterval === "week") return count === 1 ? "por semana" : `a cada ${count} semanas`;
  if (offer.billingInterval === "year") return count === 1 ? "por ano" : `a cada ${count} anos`;
  if (offer.billingInterval === "month") {
    if (count === 1) return "por mês";
    if (count === 3) return "a cada 3 meses";
    if (count === 6) return "a cada 6 meses";
    if (count === 12) return "por ano";
    return `a cada ${count} meses`;
  }
  return "recorrente";
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, "").slice(0, 11);
}

export function CheckoutFlow({
  offer,
  affiliate,
  affiliateAttribution,
  mercadoPagoPublicKey,
  successText,
  successUrl,
  successLabel,
  checkoutEndpoint = "/api/checkout/transparent",
  sessionToken,
  initialBuyer,
  prepaidSubscription = false,
  priceComposition,
}: {
  offer: Offer;
  affiliate?: string;
  affiliateAttribution?: { cookieDays: number; attributionModel: "last_click" | "first_click" };
  mercadoPagoPublicKey?: string;
  successText?: string;
  successUrl?: string;
  successLabel?: string;
  checkoutEndpoint?: string;
  sessionToken?: string;
  initialBuyer?: { name?: string | null; email?: string | null };
  prepaidSubscription?: boolean;
  priceComposition?: PriceCompositionLine[];
}) {
  const recurring = offer.billingType === "recurring";
  const initialPrice = recurring && offer.firstChargeCents ? offer.firstChargeCents : offer.priceCents;
  const defaultMethod: PaymentMethod = offer.paymentCardEnabled ? "card" : "pix";
  const [method, setMethod] = useState<PaymentMethod>(defaultMethod);
  const [sdkReady, setSdkReady] = useState(false);
  const [cardReady, setCardReady] = useState(false);
  const [cardRetryRequired, setCardRetryRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<CheckoutResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [buyer, setBuyer] = useState(() => ({
    name: initialBuyer?.name ?? "",
    email: initialBuyer?.email ?? "",
    document: "",
  }));
  const [affiliateRef, setAffiliateRef] = useState(affiliate);
  const buyerRef = useRef(buyer);
  const cardFormRef = useRef<CardFormInstance | null>(null);
  const keyRef = useRef<string | null>(null);
  const cardSubmitObservedRef = useRef(false);
  const cardSubmitWatchdogRef = useRef<number | null>(null);

  useEffect(() => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-prosperity-mp-security="true"]');
    if (existing) return;

    const script = document.createElement("script");
    script.src = "https://www.mercadopago.com/v2/security.js";
    script.async = true;
    script.setAttribute("view", "checkout");
    script.setAttribute("data-prosperity-mp-security", "true");
    document.head.appendChild(script);
  }, []);

  useEffect(() => {
    if (!affiliateAttribution) {
      setAffiliateRef(undefined);
      return;
    }
    const cookieName = `pp_aff_${offer.productId.replace(/-/g, "")}`;
    const encoded = document.cookie.split("; ").find(item => item.startsWith(`${cookieName}=`))?.split("=").slice(1).join("=");
    const stored = encoded ? decodeURIComponent(encoded) : undefined;
    let resolved = stored;
    if (affiliate) {
      resolved = affiliateAttribution.attributionModel === "first_click" && stored ? stored : affiliate;
      const secure = window.location.protocol === "https:" ? "; Secure" : "";
      document.cookie = `${cookieName}=${encodeURIComponent(resolved)}; Max-Age=${affiliateAttribution.cookieDays * 86400}; Path=/; SameSite=Lax${secure}`;
    }
    setAffiliateRef(resolved);
  }, [affiliate, affiliateAttribution, offer.productId]);

  async function waitForDeviceId(timeoutMs = 2200) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const deviceId = window.MP_DEVICE_SESSION_ID?.trim();
      if (deviceId) return deviceId;
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    return undefined;
  }

  function updateBuyer(field: keyof typeof buyer, value: string) {
    const next = { ...buyerRef.current, [field]: field === "document" ? onlyDigits(value) : value };
    buyerRef.current = next;
    setBuyer(next);
  }

  function newAttempt() {
    keyRef.current = crypto.randomUUID();
    return keyRef.current;
  }

  function reportCardEvent(event: string, message?: string) {
    void fetch("/api/checkout/client-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        event,
        offerSlug: offer.slug,
        message: message?.slice(0, 300),
      }),
    }).catch(() => undefined);
  }

  function handleCardRetry() {
    reportCardEvent("card_retry_reload");
    window.location.reload();
  }

  function handleCardSubmitClick() {
    setError("");
    cardSubmitObservedRef.current = false;
    reportCardEvent("card_submit_clicked");

    if (cardSubmitWatchdogRef.current) {
      window.clearTimeout(cardSubmitWatchdogRef.current);
    }

    cardSubmitWatchdogRef.current = window.setTimeout(() => {
      if (cardSubmitObservedRef.current) return;
      reportCardEvent("card_submit_not_observed");
      setError(
        "O Mercado Pago não conseguiu validar os dados do cartão. Revise número, validade, código de segurança e nome do titular e tente novamente."
      );
    }, 1800);
  }

  async function sendPayment(payload: Record<string, unknown>) {
    setBusy(true);
    setError("");
    const idempotencyKey = keyRef.current ?? newAttempt();
    const cardAttempt = payload.paymentMethod === "card";
    try {
      const response = await fetch(checkoutEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({
          ...(sessionToken ? { sessionToken } : { offerSlug: offer.slug, refCode: affiliateRef }),
          customerName: buyerRef.current.name,
          customerEmail: buyerRef.current.email,
          customerDocument: buyerRef.current.document,
          ...payload,
        }),
      });
      const body = await response.json() as CheckoutResult & { error?: string };
      if (!response.ok) {
        throw new Error(body.error || "Não foi possível processar o pagamento.");
      }
      setResult(body);
      if (body.status === "rejected" || body.status === "cancelled") {
        throw new Error("Pagamento não aprovado. Confira os dados ou tente outro cartão.");
      }
      return true;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Falha ao processar o pagamento.";
      setError(message);
      if (cardAttempt) {
        newAttempt();
        setCardRetryRequired(true);
        reportCardEvent("card_retry_required", message);
      } else {
        newAttempt();
      }
      return false;
    } finally {
      setBusy(false);
    }
  }

  function validateBuyerData(data: typeof buyer) {
    if (!data.name.trim()) return "Preencha o nome completo.";
    if (!data.email.trim()) return "Preencha o e-mail.";
    if (!data.document) return "Preencha o CPF.";
    if (data.document.length !== 11) return "O CPF deve conter 11 dígitos.";
    return "";
  }

  async function submitCard(cardForm: CardFormInstance) {
    try {
      const data = cardForm.getCardFormData();
      const buyerValidationError = validateBuyerData(buyerRef.current);
      if (buyerValidationError) {
        reportCardEvent("card_buyer_validation_failed", buyerValidationError);
        setError(buyerValidationError);
        return;
      }
      if (!data.token || !data.paymentMethodId) {
        reportCardEvent("card_token_missing");
        setError("O Mercado Pago não conseguiu gerar o token do cartão. Confira os dados do cartão e tente novamente.");
        return;
      }
      reportCardEvent("card_token_ready");
      const deviceId = await waitForDeviceId();
      if (!deviceId) {
        reportCardEvent("device_id_missing");
        setError("Não foi possível iniciar a validação segura do dispositivo. Recarregue a página e tente novamente.");
        return;
      }
      reportCardEvent("device_id_ready");
      setCardRetryRequired(false);
      await sendPayment({
        paymentMethod: "card",
        deviceId,
        card: {
          token: data.token,
          paymentMethodId: data.paymentMethodId,
          issuerId: data.issuerId,
          installments: recurring || prepaidSubscription ? 1 : Number(data.installments || 1),
        },
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Falha ao ler dados tokenizados.";
      console.error("[checkout-card] Falha antes do envio ao backend", cause);
      reportCardEvent("card_form_data_error", message);
      setError("Não foi possível validar o cartão com o Mercado Pago. Confira os dados e tente novamente.");
    }
  }

  async function submitPix(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const buyerValidationError = validateBuyerData(buyerRef.current);
    if (buyerValidationError) {
      setError(buyerValidationError);
      return;
    }
    await sendPayment({ paymentMethod: "pix" });
  }

  useEffect(() => {
    if (!sdkReady || !mercadoPagoPublicKey || !offer.paymentCardEnabled || !window.MercadoPago || cardFormRef.current) return;
    const mp = new window.MercadoPago(mercadoPagoPublicKey, { locale: "pt-BR" });
    const cardForm = mp.cardForm({
      amount: (initialPrice / 100).toFixed(2),
      iframe: true,
      form: {
        id: "prosperity-card-form",
        cardNumber: { id: "form-checkout__cardNumber", placeholder: "1234 5678 9012 3456" },
        expirationDate: { id: "form-checkout__expirationDate", placeholder: "MM/AA" },
        securityCode: { id: "form-checkout__securityCode", placeholder: "CVV" },
        cardholderName: { id: "form-checkout__cardholderName", placeholder: "Nome impresso no cartão" },
        issuer: { id: "form-checkout__issuer", placeholder: "Banco emissor" },
        installments: { id: "form-checkout__installments", placeholder: "Parcelas" },
        identificationType: { id: "form-checkout__identificationType", placeholder: "Documento" },
        identificationNumber: { id: "form-checkout__identificationNumber", placeholder: "CPF" },
        cardholderEmail: { id: "form-checkout__cardholderEmail", placeholder: "seu@email.com" },
      },
      callbacks: {
        onFormMounted: (mountError: unknown) => {
          if (mountError) {
            const message = mountError instanceof Error ? mountError.message : String(mountError);
            reportCardEvent("card_form_mount_error", message);
            setError("Não foi possível carregar o formulário seguro do cartão.");
            return;
          }
          reportCardEvent("card_form_mounted");
          setCardReady(true);
        },
        onSubmit: (event: Event) => {
          event.preventDefault();
          cardSubmitObservedRef.current = true;
          if (cardSubmitWatchdogRef.current) {
            window.clearTimeout(cardSubmitWatchdogRef.current);
            cardSubmitWatchdogRef.current = null;
          }
          reportCardEvent("card_submit_observed");
          void submitCard(cardForm);
        },
        onFetching: (resource: unknown) => {
          reportCardEvent("card_sdk_fetching", typeof resource === "string" ? resource : undefined);
          return () => undefined;
        },
      },
    });
    cardFormRef.current = cardForm;
    return () => {
      cardForm.unmount?.();
      cardFormRef.current = null;
    };
  }, [sdkReady, mercadoPagoPublicKey, offer.paymentCardEnabled, initialPrice]);

  useEffect(() => {
    if (!result?.orderId || !["pending", "processing"].includes(result.status)) return;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/checkout/orders/${encodeURIComponent(result.orderId)}`, { cache: "no-store" });
        const body = await response.json() as { status?: string };
        if (body.status === "paid") setResult((current) => current ? { ...current, status: "approved" } : current);
        if (["cancelled", "expired", "refunded", "charged_back"].includes(body.status ?? "")) {
          setResult((current) => current ? { ...current, status: body.status ?? "cancelled" } : current);
        }
      } catch {
        // O webhook continua sendo a fonte de verdade; o polling é apenas feedback visual.
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [result?.orderId, result?.status]);

  useEffect(() => {
    if (result?.status !== "approved" || !successUrl) return;
    const timer = window.setTimeout(() => {
      window.location.assign(successUrl);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [result?.status, successUrl]);

  async function copyPix() {
    if (!result?.qrCode) return;
    await navigator.clipboard.writeText(result.qrCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  if (result?.status === "approved") {
    return <main className={styles.page}>
      <header className={styles.header}><Brand href="/"/><span><LockKeyhole size={14}/> Ambiente seguro</span></header>
      <section className={styles.successCard}>
        <span className={styles.successIcon}><Check size={34}/></span>
        <p className={styles.eyebrow}>Pagamento confirmado</p>
        <h1>Compra aprovada.</h1>
        <p>{successText?.trim() || <>Recebemos o pagamento de <strong>{formatCents(initialPrice)}</strong> para <strong>{offer.name}</strong>.</>}</p>
        {(recurring || prepaidSubscription) && <div className={styles.successNote}>Este pagamento libera o período ou a alteração contratada. As próximas renovações continuam no modelo pré-pago.</div>}
        {successUrl && <div className={styles.successNote}>Você será direcionado automaticamente em alguns segundos.</div>}
        <a className={styles.primaryLink} href={successUrl ?? "/login"}>{successLabel ?? (successUrl ? "Continuar" : "Ir para minha conta")}</a>
      </section>
    </main>;
  }

  if (method === "pix" && result?.qrCode) {
    return <main className={styles.page}>
      <header className={styles.header}><Brand href="/"/><span><LockKeyhole size={14}/> Ambiente seguro</span></header>
      <div className={styles.pixResultLayout}>
        <section className={styles.pixResultCard}>
          <p className={styles.eyebrow}>PIX gerado</p>
          <h1>Finalize o pagamento</h1>
          <p>Abra o app do seu banco e escaneie o QR Code ou copie o código PIX.</p>
          {result.qrCodeBase64 && <div className={styles.qrBox}><Image src={`data:image/jpeg;base64,${result.qrCodeBase64}`} alt="QR Code PIX" width={230} height={230} unoptimized/></div>}
          <div className={styles.copyBox}><span>{result.qrCode}</span><button type="button" onClick={copyPix}>{copied ? <Check size={17}/> : <Copy size={17}/>} {copied ? "Copiado" : "Copiar"}</button></div>
          <div className={styles.waiting}><span></span>Aguardando confirmação do Mercado Pago...</div>
        </section>
      </div>
    </main>;
  }

  return <main className={styles.page}>
    <Script src="https://sdk.mercadopago.com/js/v2" strategy="afterInteractive" onLoad={() => setSdkReady(true)}/>
    <header className={styles.header}><Brand href="/"/><span><LockKeyhole size={14}/> Ambiente seguro</span></header>

    <div className={styles.layout}>
      <section className={styles.productPane}>
        <div className={styles.productContent}>
          {offer.imageUrl && <Image className={styles.productImage} src={offer.imageUrl} alt={offer.productName} width={720} height={400} unoptimized/>}
          <span className={styles.productBadge}>{offer.productName}</span>
          <h1>{offer.name}</h1>

          {priceComposition && priceComposition.length > 0 ? (
            <div className={styles.compositionCard}>
              <span className={styles.compositionEyebrow}>Composição</span>

              <div className={styles.compositionFormula}>
                {priceComposition.map((line, index) => (
                  <div
                    className={styles.compositionLine}
                    key={`${line.label}-${line.amountCents}-${index}`}
                  >
                    <span className={styles.compositionOperator}>
                      {index === 0 ? "" : "+"}
                    </span>
                    <div className={styles.compositionLineInfo}>
                      <strong>{line.label}</strong>
                      {line.quantity && line.quantity > 1 ? (
                        <small>Quantidade: {line.quantity}</small>
                      ) : null}
                    </div>
                    <strong className={styles.compositionAmount}>
                      {formatCents(line.amountCents)}
                    </strong>
                  </div>
                ))}

                <div className={styles.compositionDivider} />

                <div className={styles.compositionTotal}>
                  <span>Total</span>
                  <strong>{formatCents(initialPrice)}</strong>
                </div>
              </div>
            </div>
          ) : (
            <div className={styles.priceBlock}>
              <span>Total {recurring ? "da primeira cobrança" : ""}</span>
              <strong>{formatCents(initialPrice)}</strong>
              {recurring && <small>{offer.firstChargeCents && offer.firstChargeCents !== offer.priceCents ? `Depois ${formatCents(offer.priceCents)} ${recurrenceLabel(offer)}` : `${formatCents(offer.priceCents)} ${recurrenceLabel(offer)}`}</small>}
            </div>
          )}
          <div className={styles.securityNote}><ShieldCheck size={22}/><div><strong>Pagamento protegido</strong><span>Os dados do cartão são enviados diretamente ao Mercado Pago e não passam pelos servidores da Prosperity Pay.</span></div></div>
        </div>
      </section>

      <section className={styles.checkoutPane}>
        <div className={styles.checkoutCard}>
          <div className={styles.cardHeader}>
            <div>
              <span>Checkout Prosperity Pay</span>
              <h2>{offer.name}</h2>
              {priceComposition && priceComposition.length > 1 ? (
                <small className={styles.cardHeaderComposition}>
                  {priceComposition
                    .map((line) => line.label)
                    .filter(Boolean)
                    .join(" + ")}
                </small>
              ) : null}
            </div>
            <div className={styles.amount}>
              <strong>{formatCents(initialPrice)}</strong>
              {recurring && <small>{recurrenceLabel(offer)}</small>}
            </div>
          </div>

          {affiliate && <div className={styles.referral}>Indicação de afiliado aplicada</div>}

          <div className={styles.methodLabel}>Forma de pagamento</div>
          <div className={styles.methods}>
            {offer.paymentCardEnabled && <button type="button" className={method === "card" ? styles.methodActive : styles.method} onClick={() => { setMethod("card"); setError(""); setResult(null); }}><CreditCard size={20}/><span><strong>Cartão de crédito</strong><small>{recurring ? "Renovação automática" : `Até ${offer.maxInstallments}x`}</small></span></button>}
            {offer.paymentPixEnabled && <button type="button" className={method === "pix" ? styles.methodActive : styles.method} onClick={() => { setMethod("pix"); setError(""); setResult(null); }}><QrCode size={20}/><span><strong>PIX</strong><small>{recurring ? "Pagamento deste período" : "Aprovação rápida"}</small></span></button>}
          </div>

          <form id="prosperity-card-form" className={`${styles.form} ${method !== "card" ? styles.hiddenForm : ""}`}>
            <div className={styles.sectionTitle}><span>1</span><div><strong>Dados do comprador</strong><small>Usaremos esses dados para identificar sua compra.</small></div></div>
            <div className={styles.fieldGrid}>
              <label className={styles.full}>Nome completo<input value={buyer.name} onChange={(event) => updateBuyer("name", event.target.value)} autoComplete="name" required/></label>
              <label className={styles.full}>E-mail<input id="form-checkout__cardholderEmail" value={buyer.email} onChange={(event) => updateBuyer("email", event.target.value)} type="email" autoComplete="email" required/></label>
              <label className={styles.full}>CPF<input id="form-checkout__identificationNumber" value={buyer.document} onChange={(event) => updateBuyer("document", event.target.value)} inputMode="numeric" placeholder="000.000.000-00" required/></label>
            </div>
            <select id="form-checkout__identificationType" className={styles.hiddenControl} defaultValue="CPF"><option value="CPF">CPF</option></select>

            <div className={styles.sectionTitle}><span>2</span><div><strong>Dados do cartão</strong><small>Preenchimento seguro processado pelo Mercado Pago.</small></div></div>
            {!mercadoPagoPublicKey && <div className={styles.configWarning}>Falta configurar <code>NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY</code> na Vercel para habilitar o cartão.</div>}
            <div className={styles.fieldGrid}>
              <label className={styles.full}>Número do cartão<div id="form-checkout__cardNumber" className={styles.secureField}/></label>
              <label className={styles.half}>Validade<div id="form-checkout__expirationDate" className={styles.secureField}/></label>
              <label className={styles.half}>Código de segurança<div id="form-checkout__securityCode" className={styles.secureField}/></label>
              <label className={styles.full}>Nome no cartão<input id="form-checkout__cardholderName" placeholder="Como está impresso no cartão" autoComplete="cc-name"/></label>
              <label className={`${styles.full} ${recurring ? styles.hiddenControl : ""}`}>Parcelas<select id="form-checkout__installments"/></label>
            </div>
            <select id="form-checkout__issuer" className={styles.hiddenControl}/>

            {recurring && <div className={styles.recurrenceInfo}><CreditCard size={18}/><span><strong>Cobrança recorrente</strong><small>Esta primeira cobrança será feita em 1x. O cartão ficará autorizado no Mercado Pago para as próximas mensalidades.</small></span></div>}
            {error && method === "card" && <p className={styles.error} role="alert">{error}</p>}
            {cardRetryRequired && <button type="button" className={styles.retry} onClick={handleCardRetry}>Tentar novamente</button>}
            <button id="form-checkout__submit" className={styles.submit} type="submit" onClick={handleCardSubmitClick} disabled={busy || cardRetryRequired || !mercadoPagoPublicKey || !cardReady}>{busy ? "Processando..." : cardRetryRequired ? "Nova tentativa necessária" : cardReady ? `Pagar ${formatCents(initialPrice)}` : "Carregando pagamento seguro..."}</button>
          </form>

          <form className={`${styles.form} ${method !== "pix" ? styles.hiddenForm : ""}`} onSubmit={submitPix}>
            <div className={styles.sectionTitle}><span>1</span><div><strong>Dados do comprador</strong><small>Preencha os dados para gerar o PIX.</small></div></div>
            <div className={styles.fieldGrid}>
              <label className={styles.full}>Nome completo<input value={buyer.name} onChange={(event) => updateBuyer("name", event.target.value)} autoComplete="name" required/></label>
              <label className={styles.full}>E-mail<input value={buyer.email} onChange={(event) => updateBuyer("email", event.target.value)} type="email" autoComplete="email" required/></label>
              <label className={styles.full}>CPF<input value={buyer.document} onChange={(event) => updateBuyer("document", event.target.value)} inputMode="numeric" placeholder="000.000.000-00" required/></label>
            </div>
            <div className={styles.pixInfo}><QrCode size={21}/><span><strong>PIX copia e cola</strong><small>O QR Code será exibido nesta página. Não haverá redirecionamento.</small></span></div>
            {recurring && <p className={styles.manualRenewal}>O PIX paga somente o período atual. A renovação seguinte precisará de uma nova cobrança.</p>}
            {error && method === "pix" && <p className={styles.error} role="alert">{error}</p>}
            <button className={styles.submit} type="submit" disabled={busy}>{busy ? "Gerando PIX..." : `Gerar PIX de ${formatCents(initialPrice)}`}</button>
          </form>

          <footer className={styles.footer}><LockKeyhole size={13}/> Processamento seguro pelo Mercado Pago</footer>
        </div>
      </section>
    </div>
  </main>;
}
