"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, BadgeDollarSign, CalendarDays, Handshake, Package, ShoppingBag, UsersRound } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { RECURRENCE_OPTIONS, type ProductPaymentType } from "@/lib/domain/product-rules";
import { requestJson } from "@/lib/operational";
import { MAX_PRODUCT_IMAGE_BYTES, productImageUrl } from "@/lib/product-images";
import styles from "./products-view.module.css";

type ProductStats = {
  completed_sales: number;
  total_sales_cents: number;
  affiliate_count: number;
  coproducer_count: number;
};

type Product = {
  id: string;
  name: string;
  description: string | null;
  image_path: string | null;
  status: string;
  settlement_model: string;
  payment_type: ProductPaymentType;
  product_type: "digital" | "physical";
  created_at: string;
  stats: ProductStats;
};

function toCents(value: FormDataEntryValue | null) {
  return Math.round(Number(value) * 100);
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function productStatusLabel(status: string) {
  switch (status) {
    case "active": return "Ativo";
    case "inactive": return "Inativo";
    case "archived": return "Arquivado";
    default: return "Rascunho";
  }
}

function productStatusClass(status: string) {
  if (status === "active") return styles.statusActive;
  if (status === "draft") return styles.statusDraft;
  return styles.statusInactive;
}

export function ProductsView() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [paymentType, setPaymentType] = useState<ProductPaymentType>("one_time");
  const [differentFirstCharge, setDifferentFirstCharge] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const previewUrl = useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await requestJson<{ products: Product[] }>("/api/products");
      setProducts(result.products);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Erro ao carregar produtos.");
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  useEffect(() => () => { if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); }, []);

  function selectImage(file: File | null) {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = file ? URL.createObjectURL(file) : null;
    setImage(file);
    setPreview(previewUrl.current);
  }

  function resetDialogState() {
    selectImage(null);
    setDialogError("");
    setPaymentType("one_time");
    setDifferentFirstCharge(false);
  }

  function closeDialog() {
    dialog.current?.close();
    resetDialogState();
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    if (image && (image.size > MAX_PRODUCT_IMAGE_BYTES || !["image/jpeg", "image/png", "image/webp"].includes(image.type))) {
      setDialogError("Escolha uma imagem JPEG, PNG ou WebP com até 3 MB.");
      return;
    }
    setBusy(true);
    setDialogError("");
    let created = false;
    try {
      const payload = {
        name: data.get("name"),
        description: data.get("description"),
        settlementModel: data.get("settlementModel"),
        paymentType,
        productType: data.get("productType"),
        category: data.get("category"),
        supportDisplayName: data.get("supportDisplayName"),
        supportEmail: data.get("supportEmail"),
        supportWhatsapp: data.get("supportWhatsapp"),
        recurrenceFrequency: paymentType === "recurring" ? data.get("recurrenceFrequency") : null,
        differentFirstCharge: paymentType === "recurring" && differentFirstCharge,
        firstChargeCents: paymentType === "recurring" && differentFirstCharge ? toCents(data.get("firstCharge")) : null,
        recurringPriceCents: paymentType === "recurring" ? toCents(data.get("recurringPrice")) : null,
        mainOfferPriceCents: paymentType === "one_time" ? toCents(data.get("mainOfferPrice")) : null,
      };
      const result = await requestJson<{ product: { id: string } }>("/api/products", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      created = true;
      if (image) {
        const upload = new FormData();
        upload.set("image", image);
        const response = await fetch(`/api/products/${result.product.id}/image`, { method: "POST", body: upload });
        if (!response.ok) {
          const detail = await response.json().catch(() => ({}));
          throw new Error(detail.error || "Não foi possível enviar a imagem.");
        }
      }
      form.reset();
      closeDialog();
      setNotice("Produto criado com sucesso. Configure uma oferta para começar a vender.");
      await load();
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "Erro ao criar produto.";
      if (created) {
        form.reset();
        closeDialog();
        setNotice(`Produto criado sem imagem. ${detail} Você pode adicionar a imagem nas configurações do produto.`);
        await load();
      } else { setDialogError(detail); }
    } finally { setBusy(false); }
  }

  return <>
    <PageHeader title="Produtos" description="Cadastre produtos e acompanhe o desempenho comercial de cada um."
      action={<button className="primary-button" onClick={() => { setDialogError(""); dialog.current?.showModal(); }}>Novo produto</button>}/>
    {notice && <p className="form-success" role="status">{notice}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {loading ? <p>Carregando produtos...</p> : !products.length ?
      <section className="panel operational-panel"><p>Você ainda não cadastrou produtos. Crie seu primeiro produto para configurar uma oferta.</p></section> :
      <section className={styles.catalogSection}>
        <div className={styles.catalogHeading}>
          <div>
            <span>Portfólio</span>
            <h2>Seus produtos</h2>
            <p>Visão rápida de vendas, faturamento e parceiros por produto.</p>
          </div>
          <strong>{products.length} {products.length === 1 ? "produto" : "produtos"}</strong>
        </div>

        <div className={styles.productGrid}>
          {products.map((product) => {
            const imageUrl = productImageUrl(product.image_path);
            return <Link
              className={styles.productCard}
              href={`/produtos/${product.id}`}
              key={product.id}
              aria-label={`Gerenciar ${product.name}`}
            >
              <div className={styles.media}>
                {imageUrl ?
                  <Image
                    className={styles.productImage}
                    src={imageUrl}
                    alt={`Imagem do produto ${product.name}`}
                    width={720}
                    height={405}
                    unoptimized
                  /> :
                  <div className={styles.imageFallback}>
                    <span><Package size={34} strokeWidth={1.6}/></span>
                    <small>Prosperity Pay</small>
                  </div>
                }
                <div className={styles.mediaShade}/>
                <div className={styles.mediaBadges}>
                  <span className={`${styles.statusBadge} ${productStatusClass(product.status)}`}>
                    {productStatusLabel(product.status)}
                  </span>
                  <span className={styles.paymentBadge}>
                    {product.payment_type === "recurring" ? "Recorrente" : "Pagamento único"}
                  </span>
                </div>
              </div>

              <div className={styles.cardBody}>
                <div className={styles.productHeading}>
                  <div>
                    <p>
                      {product.product_type === "physical" ? "Produto físico" : "Produto digital"}
                      <span>•</span>
                      {product.settlement_model === "connected_account" ? "Mercado Pago" : "Saldo Prosperity"}
                    </p>
                    <h3>{product.name}</h3>
                  </div>
                  <span className={styles.openIcon}><ArrowUpRight size={18}/></span>
                </div>

                <p className={styles.description}>
                  {product.description?.trim() || "Sem descrição cadastrada. Adicione uma descrição para apresentar melhor este produto."}
                </p>

                <div className={styles.metricsGrid}>
                  <div className={styles.metric}>
                    <span className={styles.metricIcon}><ShoppingBag size={17}/></span>
                    <div>
                      <small>Vendas concluídas</small>
                      <strong>{formatNumber(product.stats.completed_sales)}</strong>
                    </div>
                  </div>
                  <div className={styles.metric}>
                    <span className={`${styles.metricIcon} ${styles.metricIconGold}`}><BadgeDollarSign size={18}/></span>
                    <div>
                      <small>Valor total de vendas</small>
                      <strong>{formatCurrency(product.stats.total_sales_cents)}</strong>
                    </div>
                  </div>
                  <div className={styles.metric}>
                    <span className={styles.metricIcon}><UsersRound size={17}/></span>
                    <div>
                      <small>Afiliados</small>
                      <strong>{formatNumber(product.stats.affiliate_count)}</strong>
                    </div>
                  </div>
                  <div className={styles.metric}>
                    <span className={styles.metricIcon}><Handshake size={18}/></span>
                    <div>
                      <small>Coprodutores</small>
                      <strong>{formatNumber(product.stats.coproducer_count)}</strong>
                    </div>
                  </div>
                </div>

                <div className={styles.cardFooter}>
                  <span><CalendarDays size={15}/> Cadastrado em {formatDate(product.created_at)}</span>
                  <strong>Gerenciar <ArrowUpRight size={15}/></strong>
                </div>
              </div>
            </Link>;
          })}
        </div>
      </section>}

    <dialog ref={dialog} className="product-dialog" aria-labelledby="product-dialog-title" onCancel={event => { if (busy) event.preventDefault(); }} onClose={resetDialogState}>
      <div className="product-dialog-heading"><div><h2 id="product-dialog-title">Novo produto</h2><p>Defina os dados comerciais, suporte e cobrança do produto.</p></div>
        <button type="button" className="secondary-button" aria-label="Fechar" disabled={busy} onClick={closeDialog}>Fechar</button></div>
      <form className="operational-form" onSubmit={create}>
        <div className="form-grid">
          <label>Nome<input name="name" minLength={2} maxLength={180} required autoFocus/></label>
          <label>Tipo de produto<select name="productType" defaultValue="digital"><option value="digital">Digital</option><option value="physical">Físico</option></select></label>
          <label>Tipo de pagamento<select name="paymentType" value={paymentType} onChange={event => { const value = event.target.value as ProductPaymentType; setPaymentType(value); if (value === "one_time") setDifferentFirstCharge(false); }}><option value="one_time">Único</option><option value="recurring">Recorrente</option></select></label>
          <label>Categoria<input name="category" maxLength={120} placeholder="Ex.: Software, Curso, Serviço"/></label>
          <label>Modelo de recebimento<select name="settlementModel"><option value="connected_account">Receber diretamente no Mercado Pago</option><option value="prosperity_balance">Receber como saldo no Prosperity Pay</option></select></label>
          {paymentType === "one_time" ?
            <label>Preço da oferta principal (R$)<input name="mainOfferPrice" type="number" min="0.01" step="0.01" required/></label> : <>
              <label>Frequência da recorrência<select name="recurrenceFrequency" defaultValue="monthly">{RECURRENCE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <label>Preço da recorrência (R$)<input name="recurringPrice" type="number" min="0.01" step="0.01" required/></label>
            </>}
        </div>
        {paymentType === "recurring" && <>
          <label className="checkbox-line"><input type="checkbox" checked={differentFirstCharge} onChange={event => setDifferentFirstCharge(event.target.checked)}/> Preço diferente na primeira cobrança</label>
          {differentFirstCharge && <label>Valor da primeira cobrança (R$)<input name="firstCharge" type="number" min="0.01" step="0.01" required/></label>}
        </>}
        <label>Descrição<textarea name="description" rows={3} maxLength={4000}/></label>
        <div className="form-grid">
          <label>Nome de exibição do SAC<input name="supportDisplayName" maxLength={180}/></label>
          <label>E-mail do SAC<input name="supportEmail" type="email" maxLength={320}/></label>
          <label>WhatsApp do SAC<input name="supportWhatsapp" maxLength={32} placeholder="Ex.: 5531999999999"/></label>
        </div>
        <label>Imagem (opcional, até 3 MB)<input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => selectImage(event.currentTarget.files?.[0] ?? null)}/></label>
        {preview && <Image className="product-image-preview" src={preview} alt="Prévia da imagem do produto" width={320} height={180} unoptimized/>}
        {paymentType === "recurring" && <p className="form-hint">A configuração recorrente será salva agora. A ativação da oferta recorrente permanece bloqueada até o processador de assinaturas estar habilitado.</p>}
        {dialogError && <p className="form-error" role="alert">{dialogError}</p>}
        <div className="product-dialog-actions"><button type="button" className="secondary-button" disabled={busy} onClick={closeDialog}>Cancelar</button><button className="primary-button" disabled={busy}>{busy ? "Salvando..." : "Criar produto"}</button></div>
      </form>
    </dialog>
  </>;
}
