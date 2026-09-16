"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { ProductOfferDialog } from "@/components/product-offer-dialog";
import { ProductOffersList } from "@/components/product-offers-list";
import { ProductOverviewReport } from "@/components/product-overview-report";
import { ProductAffiliateManagement, ProductCoproducerManagement } from "@/components/product-partner-management";
import { PageHeader } from "@/components/ui/page-header";
import { RECURRENCE_OPTIONS, type ProductPaymentType, type RecurrenceFrequency } from "@/lib/domain/product-rules";
import { requestJson } from "@/lib/operational";
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

const tabs = ["Visão geral", "Ofertas", "Afiliados", "Coprodutores", "Vendas", "Configurações"];

function moneyInput(cents: number | null | undefined) {
  return cents == null ? "" : (cents / 100).toFixed(2);
}
function cents(value: FormDataEntryValue | null) {
  return Math.round(Number(value) * 100);
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
      {tab === "Ofertas" && <ProductOffersList paymentType={product.payment_type} offers={offers} onNew={() => setEditingOffer(null)} onEdit={setEditingOffer} onDelete={setDeletingOffer}/>} 
      {tab === "Afiliados" && <ProductAffiliateManagement id={id}/>} 
      {tab === "Coprodutores" && <ProductCoproducerManagement id={id} offers={offers.map(offer => ({ id: offer.id, name: offer.name }))}/>} 
      {tab === "Vendas" && <p>Consulte as vendas e os detalhes financeiros em <Link href="/pagamentos">Pagamentos →</Link></p>}
    </section>}
    {product && editingOffer !== undefined && <ProductOfferDialog product={product} offer={editingOffer} busy={busy} onClose={() => setEditingOffer(undefined)} onSave={saveOffer}/>} 
    {deletingOffer && <ConfirmDeleteDialog offer={deletingOffer} busy={busy} onClose={() => setDeletingOffer(null)} onConfirm={deleteOffer}/>} 
  </>;
}

function ProductOverview({ product, offers }: { product: Product; offers: Offer[] }) {
  return <ProductOverviewReport product={product} offers={offers}/>;
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
      {paymentType === "recurring" && <p className="form-hint">A cobrança recorrente é processada pela API oficial de Assinaturas do Mercado Pago. O cliente autoriza a recorrência no checkout hospedado.</p>}
      <button className="primary-button" disabled={busy}>Salvar produto</button>
    </form>
    <div className="product-image-settings"><h2>Imagem do produto</h2>{productImageUrl(product.image_path) && <Image className="product-image-preview" src={productImageUrl(product.image_path)!} alt={product.name} width={320} height={180} unoptimized/>}<form className="operational-form" onSubmit={onChangeImage}><label>Selecionar imagem JPEG, PNG ou WebP (até 3 MB)<input type="file" name="image" accept="image/jpeg,image/png,image/webp" required/></label><button className="secondary-button" disabled={busy}>Enviar imagem</button></form>{product.image_path && <button className="secondary-button" disabled={busy} onClick={() => void onRemoveImage()}>Remover imagem</button>}</div>
  </>;
}

function ConfirmDeleteDialog({ offer, busy, onClose, onConfirm }: { offer: Offer; busy: boolean; onClose: () => void; onConfirm: () => Promise<void> }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="product-dialog confirm-dialog" onClose={onClose} onCancel={event => { if (busy) event.preventDefault(); }}>
    <div className="product-dialog-heading"><div><h2>Excluir oferta?</h2><p>Esta ação remove a oferta <strong>{offer.name}</strong>. Ofertas com histórico financeiro não podem ser excluídas.</p></div></div>
    <div className="product-dialog-actions"><button className="secondary-button" disabled={busy} onClick={() => ref.current?.close()}>Cancelar</button><button className="primary-button" disabled={busy} onClick={() => void onConfirm()}>{busy ? "Excluindo..." : "Excluir oferta"}</button></div>
  </dialog>;
}
