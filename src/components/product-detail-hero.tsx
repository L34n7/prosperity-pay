"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, BadgeDollarSign, CalendarDays, CreditCard, Package, Tags, WalletCards } from "lucide-react";
import { RECURRENCE_OPTIONS, type ProductPaymentType, type RecurrenceFrequency } from "@/lib/domain/product-rules";
import { formatCents, requestJson } from "@/lib/operational";
import { productImageUrl } from "@/lib/product-images";
import styles from "./product-detail-shell.module.css";

type Product = {
  id: string;
  name: string;
  description: string | null;
  image_path: string | null;
  status: string;
  settlement_model: string;
  created_at: string;
  payment_type: ProductPaymentType;
  product_type: "digital" | "physical";
  category: string | null;
  recurrence_frequency: RecurrenceFrequency | null;
  recurring_price_cents: number | null;
  main_offer_price_cents: number | null;
};

function statusLabel(status: string) {
  switch (status) {
    case "active": return "Ativo";
    case "inactive": return "Inativo";
    case "archived": return "Arquivado";
    default: return "Rascunho";
  }
}

function statusClass(status: string) {
  if (status === "active") return styles.statusActive;
  if (status === "draft") return styles.statusDraft;
  return styles.statusMuted;
}

function productPrice(product: Product) {
  return product.payment_type === "recurring" ? product.recurring_price_cents : product.main_offer_price_cents;
}

function formattedDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export function ProductDetailHero({ id }: { id: string }) {
  const [product, setProduct] = useState<Product | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const run = async () => {
      try {
        const result = await requestJson<{ product: Product }>(`/api/products/${id}`);
        setProduct(result.product);
        setError("");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Não foi possível carregar o resumo do produto.");
      }
    };
    void run();
  }, [id]);

  if (!product) {
    return <section className={`${styles.hero} ${styles.heroLoading}`} aria-busy="true">
      <div className={styles.loadingMedia}/>
      <div className={styles.loadingContent}>
        <span/>
        <span/>
        <span/>
        {error && <p className={styles.heroError}>{error}</p>}
      </div>
    </section>;
  }

  const imageUrl = productImageUrl(product.image_path);
  const price = productPrice(product);
  const recurrence = RECURRENCE_OPTIONS.find(option => option.value === product.recurrence_frequency)?.label;

  return <>
    <Link className={styles.backLink} href="/produtos"><ArrowLeft size={16}/> Produtos</Link>
    <section className={styles.hero}>
      <div className={styles.heroMedia}>
        {imageUrl ?
          <Image className={styles.heroImage} src={imageUrl} alt={product.name} width={720} height={540} unoptimized/> :
          <div className={styles.heroFallback}><Package size={48} strokeWidth={1.45}/><span>Prosperity Pay</span></div>}
        <div className={styles.heroMediaShade}/>
        <span className={`${styles.statusBadge} ${statusClass(product.status)}`}>{statusLabel(product.status)}</span>
      </div>

      <div className={styles.heroContent}>
        <div className={styles.heroHeading}>
          <div>
            <p className={styles.eyebrow}>Gestão do produto</p>
            <h1>{product.name}</h1>
          </div>
          <span className={styles.typePill}>{product.product_type === "physical" ? "Produto físico" : "Produto digital"}</span>
        </div>

        <p className={styles.description}>{product.description?.trim() || "Este produto ainda não possui uma descrição cadastrada."}</p>

        <div className={styles.dataGrid}>
          <div className={styles.dataCard}>
            <span><BadgeDollarSign size={17}/></span>
            <div><small>Preço principal</small><strong>{price ? formatCents(price) : "Não definido"}</strong></div>
          </div>
          <div className={styles.dataCard}>
            <span><CreditCard size={17}/></span>
            <div><small>Pagamento</small><strong>{product.payment_type === "recurring" ? `Recorrente${recurrence ? ` · ${recurrence}` : ""}` : "Pagamento único"}</strong></div>
          </div>
          <div className={styles.dataCard}>
            <span><WalletCards size={17}/></span>
            <div><small>Recebimento</small><strong>{product.settlement_model === "connected_account" ? "Mercado Pago" : "Saldo Prosperity"}</strong></div>
          </div>
          <div className={styles.dataCard}>
            <span><Tags size={17}/></span>
            <div><small>Categoria</small><strong>{product.category || "Sem categoria"}</strong></div>
          </div>
          <div className={styles.dataCard}>
            <span><Package size={17}/></span>
            <div><small>Tipo</small><strong>{product.product_type === "physical" ? "Físico" : "Digital"}</strong></div>
          </div>
          <div className={styles.dataCard}>
            <span><CalendarDays size={17}/></span>
            <div><small>Cadastrado em</small><strong>{formattedDate(product.created_at)}</strong></div>
          </div>
        </div>
      </div>
    </section>
  </>;
}
