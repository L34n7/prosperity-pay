"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ProductAffiliateManagement } from "@/components/product-affiliate-management";
import { ProductOfferDialog } from "@/components/product-offer-dialog";
import { ProductOffersList } from "@/components/product-offers-list";
import { ProductOverviewReport } from "@/components/product-overview-report";
import { ProductCoproducerManagement } from "@/components/product-partner-management";
import { ProductPaymentsManagement } from "@/components/product-payments-management";
import { ProductSettings } from "@/components/product-settings";
import { PageHeader } from "@/components/ui/page-header";
import type { ProductPaymentType, RecurrenceFrequency } from "@/lib/domain/product-rules";
import { requestJson } from "@/lib/operational";
import { MAX_PRODUCT_IMAGE_BYTES } from "@/lib/product-images";

type Product = {
  id: string;
  name: string;
  description: string | null;
  post_purchase_message: string | null;
  post_purchase_redirect_url: string | null;
  affiliate_funnel_base_url: string | null;
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

const tabs = ["Visão geral", "Ofertas", "Afiliados", "Co-Produtores", "Pagamentos", "Configurações"];

export function ProductDetail({ id }: { id: string }) {
  const router = useRouter();
  const [product, setProduct] = useState<Product | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [tab, setTab] = useState("Visão geral");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingOffer, setEditingOffer] = useState<Offer | null | undefined>(undefined);
  const [deletingOffer, setDeletingOffer] = useState<Offer | null>(null);
  const [deletingProduct, setDeletingProduct] = useState(false);

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

  async function deleteProduct() {
    setBusy(true); setError(""); setMessage("");
    try {
      await requestJson(`/api/products/${id}`, { method: "DELETE" });
      router.push("/produtos");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível excluir o produto.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <PageHeader title={product?.name ?? "Produto"} description={product?.settlement_model === "connected_account" ? "Recebimento direto no Mercado Pago" : "Recebimento no saldo Prosperity Pay"}/>
    <nav className="detail-tabs" aria-label="Gestão do produto">{tabs.map(item => <button key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>)}</nav>
    {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success" role="status">{message}</p>}
    {!product ? <p>Carregando...</p> : <section className="panel operational-panel">
      {tab === "Visão geral" && <ProductOverview product={product} offers={offers}/>} 
      {tab === "Configurações" && <ProductSettings key={product.updated_at} product={product} busy={busy} onSave={body => mutate(`/api/products/${id}`, "PATCH", body)} onChangeImage={changeImage} onRemoveImage={removeImage} onDelete={()=>setDeletingProduct(true)}/>} 
      {tab === "Ofertas" && <ProductOffersList paymentType={product.payment_type} offers={offers} onNew={() => setEditingOffer(null)} onEdit={setEditingOffer} onDelete={setDeletingOffer}/>} 
      {tab === "Afiliados" && <ProductAffiliateManagement id={id}/>} 
      {tab === "Co-Produtores" && <ProductCoproducerManagement id={id} offers={offers.map(offer => ({ id: offer.id, name: offer.name }))}/>} 
      {tab === "Pagamentos" && <ProductPaymentsManagement id={id}/>} 
    </section>}
    {product && editingOffer !== undefined && <ProductOfferDialog product={product} offer={editingOffer} busy={busy} onClose={() => setEditingOffer(undefined)} onSave={saveOffer}/>} 
    {deletingOffer && <ConfirmDeleteDialog offer={deletingOffer} busy={busy} onClose={() => setDeletingOffer(null)} onConfirm={deleteOffer}/>} 
    {deletingProduct && product && <ConfirmProductDeleteDialog productName={product.name} busy={busy} onClose={()=>setDeletingProduct(false)} onConfirm={deleteProduct}/>}
  </>;
}

function ProductOverview({ product, offers }: { product: Product; offers: Offer[] }) {
  return <ProductOverviewReport product={product} offers={offers}/>;
}

function ConfirmDeleteDialog({ offer, busy, onClose, onConfirm }: { offer: Offer; busy: boolean; onClose: () => void; onConfirm: () => Promise<void> }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="product-dialog confirm-dialog" onClose={onClose} onCancel={event => { if (busy) event.preventDefault(); }}>
    <div className="product-dialog-heading"><div><h2>Excluir oferta?</h2><p>Esta ação remove a oferta <strong>{offer.name}</strong>. Ofertas com histórico financeiro não podem ser excluídas.</p></div></div>
    <div className="product-dialog-actions"><button className="secondary-button" disabled={busy} onClick={() => ref.current?.close()}>Cancelar</button><button className="primary-button" disabled={busy} onClick={() => void onConfirm()}>{busy ? "Excluindo..." : "Excluir oferta"}</button></div>
  </dialog>;
}


function ConfirmProductDeleteDialog({ productName, busy, onClose, onConfirm }: { productName: string; busy: boolean; onClose: () => void; onConfirm: () => Promise<void> }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="product-dialog confirm-dialog" onClose={onClose} onCancel={event => { if (busy) event.preventDefault(); }}>
    <div className="product-dialog-heading"><div><h2>Excluir produto definitivamente?</h2><p>Você está prestes a excluir <strong>{productName}</strong>. Revise os impactos antes de confirmar.</p></div></div>
    <div className="delete-impact">
      <strong>O que será removido:</strong>
      <ul>
        <li>o produto, suas configurações e a imagem cadastrada;</li>
        <li>as ofertas e links de checkout vinculados ao produto;</li>
        <li>a configuração de afiliados, vínculos e links deste produto;</li>
        <li>convites e vínculos de coprodutores relacionados ao produto.</li>
      </ul>
      <p>Se existir qualquer pedido ou histórico financeiro vinculado, a exclusão será bloqueada para preservar pagamentos e relatórios. Nesse caso, mantenha o produto como <strong>Inativo</strong>.</p>
      <label className="delete-confirm-check"><input type="checkbox" checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/><span>Estou ciente de que esta ação é permanente e quero excluir o produto.</span></label>
    </div>
    <div className="product-dialog-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => ref.current?.close()}>Cancelar</button><button type="button" className="danger-button" disabled={busy||!confirmed} onClick={() => void onConfirm()}>{busy ? "Excluindo..." : "Excluir produto definitivamente"}</button></div>
  </dialog>;
}
