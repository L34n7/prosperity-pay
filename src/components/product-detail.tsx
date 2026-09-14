"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { AFFILIATE_HOLD_DAYS, getInstallmentOptions } from "@/lib/domain/offer-rules";
import { RECURRENCE_OPTIONS, type ProductPaymentType, type RecurrenceFrequency } from "@/lib/domain/product-rules";
import { formatCents, requestJson } from "@/lib/operational";
import { MAX_PRODUCT_IMAGE_BYTES, productImageUrl } from "@/lib/product-images";

type Product = {
  id: string;
  name: string;
  description: string | null;
  image_path: string | null;
  status: string;
  settlement_model: string;
  updated_at: string;
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
  first_charge_cents: number | null;
};

const tabs = ["Visão geral", "Ofertas", "Checkout", "Afiliados", "Coprodutores", "Vendas", "Configurações"];

function moneyInput(cents: number | null | undefined) {
  return cents == null ? "" : (cents / 100).toFixed(2);
}
function cents(value: FormDataEntryValue | null) {
  return Math.round(Number(value) * 100);
}
function offerMethods(offer: Offer) {
  return [offer.payment_card_enabled ? "Cartão" : null, offer.payment_pix_enabled ? "PIX" : null].filter(Boolean).join(" + ");
}
function productPrice(product: Product) {
  return product.payment_type === "recurring" ? product.recurring_price_cents : product.main_offer_price_cents;
}

export function ProductDetail({ id }: { id: string }) {
  const [product, setProduct] = useState<Product | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [tab, setTab] = useState("Visão geral");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingOffer, setEditingOffer] = useState<Offer | null | undefined>(undefined);
  const [deletingOffer, setDeletingOffer] = useState<Offer | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, o] = await Promise.all([
        requestJson<{ product: Product }>(`/api/products/${id}`),
        requestJson<{ offers: Offer[] }>(`/api/products/${id}/offers`),
      ]);
      setProduct(p.product);
      setOffers(o.offers);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Erro ao carregar.");
    }
  }, [id]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  async function mutate(path: string, method: string, body?: object, success = "Alterações salvas.") {
    setBusy(true); setError(""); setMessage("");
    try {
      await requestJson(path, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
      await load();
      setMessage(success);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Erro ao salvar.");
      return false;
    } finally { setBusy(false); }
  }

  async function changeImage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = new FormData(form).get("image");
    if (!(file instanceof File) || !file.size) { setError("Selecione uma imagem."); return; }
    if (file.size > MAX_PRODUCT_IMAGE_BYTES || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setError("Escolha uma imagem JPEG, PNG ou WebP com até 3 MB."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      const data = new FormData(); data.set("image", file);
      const response = await fetch(`/api/products/${id}/image`, { method: "POST", body: data });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Falha ao enviar imagem.");
      form.reset(); await load(); setMessage("Imagem salva.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao enviar imagem."); }
    finally { setBusy(false); }
  }

  async function removeImage() {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/products/${id}/image`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Falha ao remover imagem.");
      await load(); setMessage("Imagem removida.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao remover imagem."); }
    finally { setBusy(false); }
  }

  async function saveOffer(payload: object) {
    const offer = editingOffer;
    const success = await mutate(
      offer ? `/api/products/${id}/offers/${offer.id}` : `/api/products/${id}/offers`,
      offer ? "PATCH" : "POST",
      payload,
      offer ? "Oferta atualizada." : "Oferta criada.",
    );
    if (success) setEditingOffer(undefined);
  }

  async function deleteOffer() {
    if (!deletingOffer) return;
    const success = await mutate(`/api/products/${id}/offers/${deletingOffer.id}`, "DELETE", undefined, "Oferta excluída.");
    if (success) setDeletingOffer(null);
  }

  return <>
    <PageHeader title={product?.name ?? "Produto"} description={product?.settlement_model === "connected_account" ? "Recebimento direto no Mercado Pago" : "Recebimento no saldo Prosperity Pay"}/>
    <nav className="detail-tabs" aria-label="Gestão do produto">{tabs.map(item => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>)}</nav>
    {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success" role="status">{message}</p>}
    {!product ? <p>Carregando...</p> : <section className="panel operational-panel">
      {tab === "Visão geral" && <ProductOverview product={product} offers={offers}/>} 
      {tab === "Configurações" && <ProductSettings key={product.updated_at} product={product} busy={busy} onSave={body => mutate(`/api/products/${id}`, "PATCH", body)} onChangeImage={changeImage} onRemoveImage={removeImage}/>} 
      {tab === "Ofertas" && <OffersList product={product} offers={offers} onNew={() => setEditingOffer(null)} onEdit={setEditingOffer} onDelete={setDeletingOffer}/>} 
      {tab === "Checkout" && <><h2>Links de checkout</h2>{offers.filter(o => o.status === "active").length ? offers.filter(o => o.status === "active").map(o => <div className="record-row" key={o.id}><strong>{o.name}</strong><span>{formatCents(o.price_cents)}</span><Link href={`/checkout/${o.checkout_slug}`} target="_blank">Abrir checkout</Link><button className="secondary-button" onClick={async () => { await navigator.clipboard.writeText(`${location.origin}/checkout/${o.checkout_slug}`); setMessage("Link copiado."); }}>Copiar link</button></div>) : <p>Ative uma oferta para gerar seu link.</p>}</>}
      {tab === "Afiliados" && <AffiliateManagement id={id}/>} 
      {tab === "Coprodutores" && <CoproducerManagement id={id} offers={offers}/>} 
      {tab === "Vendas" && <p>Consulte as vendas e os detalhes financeiros em <Link href="/pagamentos">Pagamentos →</Link></p>}
    </section>}
    {product && editingOffer !== undefined && <OfferDialog product={product} offer={editingOffer} busy={busy} onClose={() => setEditingOffer(undefined)} onSave={saveOffer}/>} 
    {deletingOffer && <ConfirmDeleteDialog offer={deletingOffer} busy={busy} onClose={() => setDeletingOffer(null)} onConfirm={deleteOffer}/>} 
  </>;
}

function ProductOverview({ product, offers }: { product: Product; offers: Offer[] }) {
  const price = productPrice(product);
  return <>
    {productImageUrl(product.image_path) && <Image className="product-detail-image" src={productImageUrl(product.image_path)!} alt={product.name} width={640} height={360} unoptimized/>}
    <h2>{product.name}</h2><p>{product.description || "Sem descrição."}</p>
    <div className="records-list">
      <div className="record-row"><strong>Pagamento</strong><span>{product.payment_type === "recurring" ? "Recorrente" : "Único"}</span><span>{price ? formatCents(price) : "Sem preço"}</span></div>
      <div className="record-row"><strong>Produto</strong><span>{product.product_type === "physical" ? "Físico" : "Digital"}</span><span>{product.category || "Sem categoria"}</span></div>
      <div className="record-row"><strong>Status</strong><span>{product.status}</span><span>{offers.length} oferta(s)</span></div>
      {product.payment_type === "recurring" && <div className="record-row"><strong>Recorrência</strong><span>{RECURRENCE_OPTIONS.find(item => item.value === product.recurrence_frequency)?.label ?? "—"}</span><span>{product.different_first_charge ? `1ª cobrança ${formatCents(product.first_charge_cents ?? 0)}` : "Mesmo valor na 1ª cobrança"}</span></div>}
      <div className="record-row"><strong>SAC</strong><span>{product.support_display_name || "Não informado"}</span><span>{product.support_email || product.support_whatsapp || "Sem contato"}</span></div>
    </div>
    <p>O modelo de recebimento foi definido na criação e não pode ser alterado.</p>
    {product.settlement_model === "connected_account" && <Link href="/integracoes">Ver conexão Mercado Pago →</Link>}
  </>;
}

function ProductSettings({ product, busy, onSave, onChangeImage, onRemoveImage }: {
  product: Product;
  busy: boolean;
  onSave: (body: object) => Promise<boolean>;
  onChangeImage: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onRemoveImage: () => Promise<void>;
}) {
  const [paymentType, setPaymentType] = useState<ProductPaymentType>(product.payment_type);
  const [differentFirstCharge, setDifferentFirstCharge] = useState(product.different_first_charge);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await onSave({
      name: data.get("name"), description: data.get("description"), status: data.get("status"),
      paymentType, productType: data.get("productType"), category: data.get("category"),
      supportDisplayName: data.get("supportDisplayName"), supportEmail: data.get("supportEmail"), supportWhatsapp: data.get("supportWhatsapp"),
      recurrenceFrequency: paymentType === "recurring" ? data.get("recurrenceFrequency") : null,
      differentFirstCharge: paymentType === "recurring" && differentFirstCharge,
      firstChargeCents: paymentType === "recurring" && differentFirstCharge ? cents(data.get("firstCharge")) : null,
      recurringPriceCents: paymentType === "recurring" ? cents(data.get("recurringPrice")) : null,
      mainOfferPriceCents: paymentType === "one_time" ? cents(data.get("mainOfferPrice")) : null,
    });
  }
  return <>
    <form className="operational-form" onSubmit={submit}>
      <div className="form-grid">
        <label>Nome<input name="name" defaultValue={product.name} required minLength={2}/></label>
        <label>Status<select name="status" defaultValue={product.status}>{["draft", "active", "inactive", "archived"].map(s => <option key={s} value={s}>{s}</option>)}</select></label>
        <label>Tipo de produto<select name="productType" defaultValue={product.product_type}><option value="digital">Digital</option><option value="physical">Físico</option></select></label>
        <label>Categoria<input name="category" defaultValue={product.category ?? ""} maxLength={120}/></label>
        <label>Tipo de pagamento<select value={paymentType} onChange={event => { const value = event.target.value as ProductPaymentType; setPaymentType(value); if (value === "one_time") setDifferentFirstCharge(false); }}><option value="one_time">Único</option><option value="recurring">Recorrente</option></select></label>
        {paymentType === "one_time" ? <label>Preço da oferta principal (R$)<input name="mainOfferPrice" type="number" min="0.01" step="0.01" defaultValue={moneyInput(product.main_offer_price_cents)} required/></label> : <>
          <label>Frequência<select name="recurrenceFrequency" defaultValue={product.recurrence_frequency ?? "monthly"}>{RECURRENCE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label>Preço da recorrência (R$)<input name="recurringPrice" type="number" min="0.01" step="0.01" defaultValue={moneyInput(product.recurring_price_cents)} required/></label>
        </>}
      </div>
      {paymentType === "recurring" && <><label className="checkbox-line"><input type="checkbox" checked={differentFirstCharge} onChange={event => setDifferentFirstCharge(event.target.checked)}/> Preço diferente na primeira cobrança</label>{differentFirstCharge && <label>Valor da primeira cobrança (R$)<input name="firstCharge" type="number" min="0.01" step="0.01" defaultValue={moneyInput(product.first_charge_cents)} required/></label>}</>}
      <label>Descrição<textarea name="description" defaultValue={product.description ?? ""}/></label>
      <div className="form-grid">
        <label>Nome de exibição do SAC<input name="supportDisplayName" defaultValue={product.support_display_name ?? ""} maxLength={180}/></label>
        <label>E-mail do SAC<input name="supportEmail" type="email" defaultValue={product.support_email ?? ""} maxLength={320}/></label>
        <label>WhatsApp do SAC<input name="supportWhatsapp" defaultValue={product.support_whatsapp ?? ""} maxLength={32}/></label>
      </div>
      {paymentType === "recurring" && <p className="form-hint">As ofertas passam a usar esta frequência. A cobrança recorrente ainda precisa do processador de assinaturas para ser ativada no checkout.</p>}
      <button className="primary-button" disabled={busy}>Salvar produto</button>
    </form>
    <div className="product-image-settings"><h2>Imagem do produto</h2>{productImageUrl(product.image_path) && <Image className="product-image-preview" src={productImageUrl(product.image_path)!} alt={product.name} width={320} height={180} unoptimized/>}<form className="operational-form" onSubmit={onChangeImage}><label>Selecionar imagem JPEG, PNG ou WebP (até 3 MB)<input type="file" name="image" accept="image/jpeg,image/png,image/webp" required/></label><button className="secondary-button" disabled={busy}>Enviar imagem</button></form>{product.image_path && <button className="secondary-button" disabled={busy} onClick={() => void onRemoveImage()}>Remover imagem</button>}</div>
  </>;
}

function OffersList({ product, offers, onNew, onEdit, onDelete }: { product: Product; offers: Offer[]; onNew: () => void; onEdit: (offer: Offer) => void; onDelete: (offer: Offer) => void }) {
  return <>
    <div className="button-row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}><div><h2 style={{ marginBottom: 4 }}>Ofertas</h2><p style={{ margin: 0 }}>Gerencie preço, checkout, pagamento e afiliados.</p></div><button className="primary-button" onClick={onNew}>Nova oferta</button></div>
    {!offers.length ? <p>Nenhuma oferta cadastrada.</p> : <div className="records-list">
      {offers.map(offer => <div className="record-row" key={offer.id} style={{ flexWrap: "wrap", gap: 12 }}>
        <div style={{ minWidth: 220, flex: "1 1 260px" }}><strong style={{ display: "block" }}>{offer.name}</strong><Link href={`/checkout/${offer.checkout_slug}`} target="_blank" style={{ display: "block", marginTop: 4, fontSize: ".72rem" }}>/checkout/{offer.checkout_slug}</Link></div>
        <span><small style={{ display: "block" }}>Preço</small>{formatCents(offer.price_cents)}</span>
        <span><small style={{ display: "block" }}>Métodos</small>{offerMethods(offer)}</span>
        <span><small style={{ display: "block" }}>Afiliados</small>{offer.affiliate_enabled ? `Habilitado · ${offer.affiliate_commission_bps / 100}%` : "Não"}</span>
        <span><small style={{ display: "block" }}>Status</small>{offer.status === "active" ? "Ativa" : "Rascunho"}</span>
        <div className="button-row"><button className="secondary-button" onClick={() => onEdit(offer)}>Editar</button><button className="secondary-button" onClick={() => onDelete(offer)}>Excluir</button></div>
      </div>)}
    </div>}
    {product.payment_type === "recurring" && <p className="form-hint">Você já pode montar todas as ofertas recorrentes. A ativação ficará disponível quando o processador de assinaturas estiver implementado.</p>}
  </>;
}

function OfferDialog({ product, offer, busy, onClose, onSave }: { product: Product; offer: Offer | null; busy: boolean; onClose: () => void; onSave: (payload: object) => Promise<void> }) {
  const ref = useRef<HTMLDialogElement>(null);
  const defaultPrice = offer?.price_cents ?? productPrice(product) ?? 0;
  const [price, setPrice] = useState(moneyInput(defaultPrice));
  const [cardEnabled, setCardEnabled] = useState(offer?.payment_card_enabled ?? true);
  const [pixEnabled, setPixEnabled] = useState(offer?.payment_pix_enabled ?? true);
  const [primary, setPrimary] = useState<"card" | "pix">(offer?.primary_payment_method ?? "card");
  const [affiliateEnabled, setAffiliateEnabled] = useState(offer?.affiliate_enabled ?? false);
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
      name: data.get("name"), priceCents: cents(data.get("price")), paymentCardEnabled: cardEnabled, paymentPixEnabled: pixEnabled,
      primaryPaymentMethod: primary, maxInstallments: cardEnabled ? maxInstallments : 1,
      firstChargeCents: product.payment_type === "recurring" && product.different_first_charge ? cents(data.get("firstCharge")) : null,
      active: product.payment_type === "one_time" && data.get("active") === "on",
      affiliateEnabled, affiliateCommissionBps: affiliateEnabled ? Math.round(Number(data.get("commission") || 0) * 100) : (offer?.affiliate_commission_bps ?? 0),
    });
  }

  return <dialog ref={ref} className="product-dialog offer-dialog" onClose={onClose} onCancel={event => { if (busy) event.preventDefault(); }}>
    <div className="product-dialog-heading"><div><h2>{offer ? "Editar oferta" : "Nova oferta"}</h2><p>Configure checkout, preço e regras comerciais desta oferta.</p></div><button type="button" className="secondary-button" disabled={busy} onClick={() => ref.current?.close()}>Fechar</button></div>
    <form className="operational-form" onSubmit={submit}>
      <div className="form-grid">
        <label>Nome<input name="name" defaultValue={offer?.name ?? "Oferta principal"} required minLength={2}/></label>
        <label>{product.payment_type === "recurring" ? "Preço da recorrência (R$)" : "Preço (R$)"}<input name="price" type="number" min="0.01" step="0.01" value={price} onChange={event => changePrice(event.target.value)} required/></label>
      </div>
      <fieldset className="form-fieldset"><legend>Métodos de pagamento disponíveis</legend><label className="checkbox-line"><input type="checkbox" checked={cardEnabled} onChange={event => changeCard(event.target.checked)}/> Cartão</label><label className="checkbox-line"><input type="checkbox" checked={pixEnabled} onChange={event => changePix(event.target.checked)}/> PIX</label></fieldset>
      <fieldset className="form-fieldset"><legend>Método de pagamento principal</legend><label className="checkbox-line"><input type="radio" name="primary" checked={primary === "card"} disabled={!cardEnabled} onChange={() => setPrimary("card")}/> Cartão</label><label className="checkbox-line"><input type="radio" name="primary" checked={primary === "pix"} disabled={!pixEnabled} onChange={() => setPrimary("pix")}/> PIX</label></fieldset>
      {product.payment_type === "recurring" && product.different_first_charge && <label>Valor da primeira cobrança (R$)<input name="firstCharge" type="number" min="0.01" step="0.01" defaultValue={moneyInput(offer?.first_charge_cents ?? product.first_charge_cents)} required/></label>}
      <label>Quantidade máxima de parcelas<select value={maxInstallments} disabled={!cardEnabled} onChange={event => setMaxInstallments(Number(event.target.value))}>{allowedInstallments.map(value => <option value={value} key={value}>{value}x</option>)}</select><small>Parcela mínima de R$ 50, limitado a 12x.</small></label>
      <label className="checkbox-line"><input type="checkbox" name="active" defaultChecked={offer?.status === "active"} disabled={product.payment_type === "recurring"}/> Oferta ativa</label>
      {product.payment_type === "recurring" && <p className="form-hint">A oferta recorrente será salva como rascunho até a integração de assinaturas estar habilitada.</p>}
      <label className="checkbox-line"><input type="checkbox" checked={affiliateEnabled} onChange={event => setAffiliateEnabled(event.target.checked)}/> Disponível para afiliado</label>
      {affiliateEnabled && <label>Comissão padrão de afiliado (%)<input name="commission" type="number" min="0" max="100" step="0.01" defaultValue={(offer?.affiliate_commission_bps ?? 0) / 100}/></label>}
      <div className="record-row"><strong>Liberação da comissão</strong><span>{AFFILIATE_HOLD_DAYS} dias após a aprovação</span></div>
      <div className="product-dialog-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => ref.current?.close()}>Cancelar</button><button className="primary-button" disabled={busy || (!cardEnabled && !pixEnabled)}>{busy ? "Salvando..." : offer ? "Salvar oferta" : "Criar oferta"}</button></div>
    </form>
  </dialog>;
}

function ConfirmDeleteDialog({ offer, busy, onClose, onConfirm }: { offer: Offer; busy: boolean; onClose: () => void; onConfirm: () => Promise<void> }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="product-dialog confirm-dialog" onClose={onClose} onCancel={event => { if (busy) event.preventDefault(); }}>
    <div className="product-dialog-heading"><div><h2>Excluir oferta?</h2><p>Esta ação remove a oferta <strong>{offer.name}</strong>. Ofertas com histórico financeiro não podem ser excluídas.</p></div></div>
    <div className="product-dialog-actions"><button className="secondary-button" disabled={busy} onClick={() => ref.current?.close()}>Cancelar</button><button className="primary-button" disabled={busy} onClick={() => void onConfirm()}>{busy ? "Excluindo..." : "Excluir oferta"}</button></div>
  </dialog>;
}

function AffiliateManagement({ id }: { id: string }) {
  const [mode, setMode] = useState("approval"), [active, setActive] = useState(false), [members, setMembers] = useState<{ id: string; code: string; status: string; profiles: { full_name: string } }[]>([]), [error, setError] = useState("");
  useEffect(() => { const run = async () => { try { const data = await requestJson<{ program: { mode: string; active: boolean } | null; memberships: typeof members }>(`/api/products/${id}/affiliates`); if (data.program) { setMode(data.program.mode); setActive(data.program.active); } setMembers(data.memberships); } catch (cause) { setError(String(cause)); } }; void run(); }, [id]);
  return <><h2>Programa de afiliados</h2><form className="operational-form" onSubmit={async e => { e.preventDefault(); try { await requestJson(`/api/products/${id}/affiliate-program`, { method: "PUT", body: JSON.stringify({ mode, active, cookieDays: 30 }) }); setError(""); } catch (cause) { setError(String(cause)); } }}><label>Modo<select value={mode} onChange={e => setMode(e.target.value)}><option value="public">Público</option><option value="approval">Sob aprovação</option><option value="invite">Convite</option></select></label><label className="checkbox-line"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)}/> Programa ativo</label><button className="primary-button">Salvar programa</button></form>{error && <p className="form-error">{error}</p>}{members.map(m => <div className="record-row" key={m.id}>{m.profiles?.full_name} · {m.code} · {m.status}{m.status === "pending" && <button className="secondary-button" onClick={async () => { await requestJson(`/api/products/${id}/affiliates/${m.id}`, { method: "PATCH", body: JSON.stringify({ status: "active" }) }); setMembers(items => items.map(item => item.id === m.id ? { ...item, status: "active" } : item)); }}>Aprovar</button>}</div>)}</>;
}

function CoproducerManagement({ id, offers }: { id: string; offers: Offer[] }) {
  const [link, setLink] = useState(""), [error, setError] = useState("");
  const [invitations, setInvitations] = useState<{ id: string; invited_email: string; participation_bps: number; status: string }[]>([]);
  const [participants, setParticipants] = useState<{ id: string; user_id: string; participation_bps: number; active: boolean }[]>([]);
  const load = useCallback(async () => { try { const data = await requestJson<{ invitations: typeof invitations; participants: typeof participants }>(`/api/products/${id}/coproducers/invitations`); setInvitations(data.invitations); setParticipants(data.participants); } catch (cause) { setError(String(cause)); } }, [id]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  return <><h2>Convidar coprodutor</h2><form className="operational-form form-grid" onSubmit={async e => { e.preventDefault(); const d = new FormData(e.currentTarget); try { const result = await requestJson<{ invitationUrl: string }>(`/api/products/${id}/coproducers/invitations`, { method: "POST", body: JSON.stringify({ email: d.get("email"), participationBps: Math.round(Number(d.get("share")) * 100), offerId: d.get("offerId") || undefined }) }); setLink(result.invitationUrl); setError(""); await load(); } catch (cause) { setError(String(cause)); } }}><label>E-mail<input name="email" type="email" required/></label><label>Participação (%)<input name="share" type="number" min="0.01" max="100" step="0.01" required/></label><label>Aplicação<select name="offerId"><option value="">Produto inteiro</option>{offers.map(o => <option value={o.id} key={o.id}>{o.name}</option>)}</select></label><button className="primary-button">Criar convite</button></form>{link && <p>Envie este link ao convidado: <button className="secondary-button" onClick={() => navigator.clipboard.writeText(link)}>Copiar convite</button></p>}{error && <p className="form-error">{error}</p>}
    <h3>Convites</h3>{invitations.length ? invitations.map(item => <div className="record-row" key={item.id}><strong>{item.invited_email}</strong><span>{item.participation_bps / 100}% · {item.status}</span></div>) : <p>Nenhum convite.</p>}
    <h3>Participações ativas</h3>{participants.filter(p => p.active).length ? participants.filter(p => p.active).map(item => <div className="record-row" key={item.id}><strong>{item.user_id}</strong><span>{item.participation_bps / 100}%</span></div>) : <p>Nenhuma participação ativa.</p>}</>;
}
