"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, BadgeDollarSign, CalendarDays, Handshake, ImageIcon, LifeBuoy, Package, ReceiptText, ShoppingBag, UsersRound, X } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { PRODUCT_CATEGORIES, type ProductPaymentType } from "@/lib/domain/product-rules";
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
        settlementModel: "prosperity_balance",
        paymentType: "one_time",
        productType: data.get("productType"),
        category: data.get("category"),
        supportDisplayName: data.get("supportDisplayName"),
        supportEmail: data.get("supportEmail"),
        supportWhatsapp: data.get("supportWhatsapp"),
        recurrenceFrequency: null,
        differentFirstCharge: false,
        firstChargeCents: null,
        recurringPriceCents: null,
        mainOfferPriceCents: toCents(data.get("mainOfferPrice")),
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
                  {product.description?.trim() || "Sem descrição interna cadastrada."}
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

    <dialog ref={dialog} className={styles.createDialog} aria-labelledby="product-dialog-title" onCancel={event => { if (busy) event.preventDefault(); }} onClose={resetDialogState}>
      <form className={styles.createForm} onSubmit={create}>
        <header className={styles.createHeader}>
          <div><span>Novo produto</span><h2 id="product-dialog-title">Cadastrar produto</h2><p>Organize as informações principais, cobrança, suporte e identidade visual do produto.</p></div>
          <button type="button" className={styles.createClose} aria-label="Fechar" disabled={busy} onClick={closeDialog}><X size={19}/></button>
        </header>

        <div className={styles.createBody}>
          <section className={styles.createBlock}>
            <div className={styles.createBlockTitle}><span><Package size={17}/></span><div><h3>Informações do produto</h3><p>Dados usados para identificar e organizar o produto dentro da Prosperity Pay.</p></div></div>
            <div className={styles.createStack}>
              <label className={styles.createField}><span>Nome</span><input name="name" minLength={2} maxLength={180} required autoFocus/></label>
              <label className={styles.createField}><span>Descrição interna</span><textarea name="description" rows={3} maxLength={4000} placeholder="Observações internas sobre o produto."/>&nbsp;<small>Essa descrição não é exibida para os clientes.</small></label>
            </div>
          </section>

          <section className={styles.createBlock}>
            <div className={styles.createBlockTitle}><span><ReceiptText size={17}/></span><div><h3>Comercial e cobrança</h3><p>Defina o tipo do produto, categoria e preço padrão.</p></div></div>
            <div className={styles.createGrid}>
              <label className={styles.createField}><span>Tipo de produto</span><select name="productType" defaultValue="digital"><option value="digital">Digital</option><option value="physical">Físico</option></select></label>
              <label className={styles.createField}><span>Tipo de pagamento</span><select name="paymentType" value="one_time" disabled><option value="one_time">Pagamento único</option></select></label>
              <label className={styles.createField}><span>Categoria</span><select name="category" defaultValue=""><option value="">Selecione</option>{PRODUCT_CATEGORIES.map(category => <option key={category} value={category}>{category}</option>)}</select></label>
              <label className={styles.createField}><span>Preço padrão</span><div className={styles.priceField}><small>R$</small><input name="mainOfferPrice" type="number" min="0.01" step="0.01" required/></div></label>
            </div>
          </section>

          <section className={styles.createBlock}>
            <div className={styles.createBlockTitle}><span><LifeBuoy size={17}/></span><div><h3>Atendimento e SAC</h3><p>Contatos que poderão ser apresentados ao comprador quando necessário.</p></div></div>
            <div className={styles.createGridThree}>
              <label className={styles.createField}><span>Nome de exibição</span><input name="supportDisplayName" maxLength={180}/></label>
              <label className={styles.createField}><span>E-mail do SAC</span><input name="supportEmail" type="email" maxLength={320}/></label>
              <label className={styles.createField}><span>WhatsApp</span><input name="supportWhatsapp" maxLength={32} placeholder="5531999999999"/></label>
            </div>
          </section>

          <section className={styles.createBlock}>
            <div className={styles.createBlockTitle}><span><ImageIcon size={17}/></span><div><h3>Imagem do produto</h3><p>Opcional. Envie JPEG, PNG ou WebP com até 3 MB.</p></div></div>
            <label className={styles.createUpload}>
              <ImageIcon size={18}/>
              <div><strong>{image ? image.name : "Selecionar imagem"}</strong><small>{image ? "Arquivo pronto para envio." : "Clique para escolher uma imagem do seu dispositivo."}</small></div>
              <input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => selectImage(event.currentTarget.files?.[0] ?? null)}/>
            </label>
            {preview && <Image className={styles.createPreview} src={preview} alt="Prévia da imagem do produto" width={420} height={236} unoptimized/>}
          </section>

          {dialogError && <p className={styles.createError} role="alert">{dialogError}</p>}
        </div>

        <footer className={styles.createFooter}>
          <span>Você poderá editar todas essas informações depois.</span>
          <div><button type="button" className={styles.createSecondary} disabled={busy} onClick={closeDialog}>Cancelar</button><button className={styles.createPrimary} disabled={busy}>{busy ? "Salvando..." : "Criar produto"}</button></div>
        </footer>
      </form>
    </dialog>
  </>;
}
