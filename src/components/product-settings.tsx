"use client";

import Image from "next/image";
import { FormEvent, useState } from "react";
import { ExternalLink, ImageIcon, LifeBuoy, Package, ReceiptText, Save, Trash2, Upload } from "lucide-react";
import { RECURRENCE_OPTIONS, type ProductPaymentType, type RecurrenceFrequency } from "@/lib/domain/product-rules";
import { productImageUrl } from "@/lib/product-images";
import styles from "./product-settings.module.css";

type Product = {
  id: string;
  name: string;
  description: string | null;
  post_purchase_message: string | null;
  post_purchase_redirect_url: string | null;
  image_path: string | null;
  status: string;
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

type Props = {
  product: Product;
  busy: boolean;
  onSave: (body: object) => Promise<boolean>;
  onChangeImage: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onRemoveImage: () => Promise<void>;
};

function moneyInput(cents: number | null | undefined) {
  return cents == null ? "" : (cents / 100).toFixed(2);
}

function cents(value: FormDataEntryValue | null) {
  return Math.round(Number(value) * 100);
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`${styles.switch} ${checked ? styles.switchOn : ""}`} onClick={() => onChange(!checked)}><span/></button>;
}

export function ProductSettings({ product, busy, onSave, onChangeImage, onRemoveImage }: Props) {
  const [paymentType, setPaymentType] = useState<ProductPaymentType>(product.payment_type);
  const [differentFirstCharge, setDifferentFirstCharge] = useState(product.different_first_charge);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await onSave({
      name: data.get("name"),
      description: data.get("description"),
      postPurchaseMessage: data.get("postPurchaseMessage"),
      postPurchaseRedirectUrl: data.get("postPurchaseRedirectUrl"),
      status: data.get("status"),
      paymentType,
      productType: data.get("productType"),
      category: data.get("category"),
      supportDisplayName: data.get("supportDisplayName"),
      supportEmail: data.get("supportEmail"),
      supportWhatsapp: data.get("supportWhatsapp"),
      recurrenceFrequency: paymentType === "recurring" ? data.get("recurrenceFrequency") : null,
      differentFirstCharge: paymentType === "recurring" && differentFirstCharge,
      firstChargeCents: paymentType === "recurring" && differentFirstCharge ? cents(data.get("firstCharge")) : null,
      recurringPriceCents: paymentType === "recurring" ? cents(data.get("recurringPrice")) : null,
      mainOfferPriceCents: paymentType === "one_time" ? cents(data.get("mainOfferPrice")) : null,
    });
  }

  const imageUrl = productImageUrl(product.image_path);

  return <div className={styles.shell}>
    <section className={styles.hero}>
      <div className={styles.heroIcon}><Package size={19}/></div>
      <div><small>Produto</small><h2>Configurações</h2><p>Organize informações comerciais, cobrança e dados de atendimento.</p></div>
    </section>

    <form className={styles.form} onSubmit={submit}>
      <section className={styles.card}>
        <div className={styles.cardHeader}><div><span><Package size={16}/></span><div><h3>Informações principais</h3><p>Dados que identificam o produto dentro da plataforma.</p></div></div></div>
        <div className={styles.stack}>
          <label className={styles.field}><span>Nome</span><input name="name" defaultValue={product.name} required minLength={2}/></label>
          <label className={styles.field}><span>Descrição interna <small className={styles.labelHint}>(Essa descrição não é exibida para os clientes)</small></span><textarea name="description" defaultValue={product.description ?? ""} rows={4} placeholder="Use este campo para observações internas sobre o produto."/></label>
          <div className={styles.gridThree}>
            <label className={styles.field}><span>Status</span><select name="status" defaultValue={product.status}><option value="draft">Rascunho</option><option value="active">Ativo</option><option value="inactive">Inativo</option><option value="archived">Arquivado</option></select></label>
            <label className={styles.field}><span>Tipo de produto</span><select name="productType" defaultValue={product.product_type}><option value="digital">Digital</option><option value="physical">Físico</option></select></label>
            <label className={styles.field}><span>Categoria</span><input name="category" defaultValue={product.category ?? ""} maxLength={120} placeholder="Ex.: Software"/></label>
          </div>
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}><div><span><ReceiptText size={16}/></span><div><h3>Cobrança</h3><p>Defina o modelo principal usado pelas ofertas deste produto.</p></div></div></div>
        <div className={styles.gridTwo}>
          <label className={styles.field}><span>Tipo de pagamento</span><select value={paymentType} onChange={event => { const next = event.target.value as ProductPaymentType; setPaymentType(next); if (next === "one_time") setDifferentFirstCharge(false); }}><option value="one_time">Pagamento único</option><option value="recurring">Recorrente</option></select></label>
          {paymentType === "one_time" ? <label className={styles.field}><span>Preço da oferta principal</span><div className={styles.money}><small>R$</small><input name="mainOfferPrice" type="number" min="0.01" step="0.01" defaultValue={moneyInput(product.main_offer_price_cents)} required/></div></label> : <label className={styles.field}><span>Preço da recorrência</span><div className={styles.money}><small>R$</small><input name="recurringPrice" type="number" min="0.01" step="0.01" defaultValue={moneyInput(product.recurring_price_cents)} required/></div></label>}
        </div>
        {paymentType === "recurring" && <div className={styles.recurringBox}>
          <label className={styles.field}><span>Frequência</span><select name="recurrenceFrequency" defaultValue={product.recurrence_frequency ?? "monthly"}>{RECURRENCE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <div className={styles.toggleRow}><div><strong>Primeira cobrança diferente</strong><small>Use um valor inicial diferente do valor recorrente.</small></div><Switch checked={differentFirstCharge} onChange={setDifferentFirstCharge} label="Primeira cobrança diferente"/></div>
          {differentFirstCharge && <label className={styles.field}><span>Valor da primeira cobrança</span><div className={styles.money}><small>R$</small><input name="firstCharge" type="number" min="0.01" step="0.01" defaultValue={moneyInput(product.first_charge_cents)} required/></div></label>}
          <p className={styles.hint}>Cobranças recorrentes são processadas pela API oficial de Assinaturas do Mercado Pago.</p>
        </div>}
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}><div><span><ExternalLink size={16}/></span><div><h3>Pós-compra</h3><p>Defina a mensagem de confirmação e para onde o cliente será direcionado após a aprovação.</p></div></div></div>
        <div className={styles.stack}>
          <label className={styles.field}><span>Texto que o cliente verá</span><textarea name="postPurchaseMessage" defaultValue={product.post_purchase_message ?? ""} rows={4} maxLength={4000} placeholder="Ex.: Pagamento aprovado! Você será direcionado para as instruções de acesso."/></label>
          <label className={styles.field}><span>URL de direcionamento</span><input name="postPurchaseRedirectUrl" type="url" defaultValue={product.post_purchase_redirect_url ?? ""} maxLength={2048} placeholder="https://seusite.com/obrigado"/></label>
          <p className={styles.hint}>Quando a URL estiver preenchida, o cliente será direcionado automaticamente após a confirmação e também terá um botão para continuar imediatamente.</p>
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}><div><span><LifeBuoy size={16}/></span><div><h3>Atendimento e SAC</h3><p>Informações de contato apresentadas ao comprador quando necessário.</p></div></div></div>
        <div className={styles.gridThree}>
          <label className={styles.field}><span>Nome de exibição</span><input name="supportDisplayName" defaultValue={product.support_display_name ?? ""} maxLength={180}/></label>
          <label className={styles.field}><span>E-mail</span><input name="supportEmail" type="email" defaultValue={product.support_email ?? ""} maxLength={320}/></label>
          <label className={styles.field}><span>WhatsApp</span><input name="supportWhatsapp" defaultValue={product.support_whatsapp ?? ""} maxLength={32}/></label>
        </div>
      </section>

      <div className={styles.actions}><button className={styles.save} disabled={busy}><Save size={15}/>{busy ? "Salvando..." : "Salvar configurações"}</button></div>
    </form>

    <section className={styles.card}>
      <div className={styles.cardHeader}><div><span><ImageIcon size={16}/></span><div><h3>Imagem do produto</h3><p>Use uma imagem horizontal em JPEG, PNG ou WebP com até 3 MB.</p></div></div></div>
      <div className={styles.imageArea}>
        <div className={styles.preview}>{imageUrl ? <Image src={imageUrl} alt={product.name} width={360} height={210} unoptimized/> : <div><ImageIcon size={24}/><span>Nenhuma imagem enviada</span></div>}</div>
        <div className={styles.imageActions}>
          <form onSubmit={onChangeImage}><label className={styles.upload}><Upload size={15}/><span>Selecionar imagem</span><input type="file" name="image" accept="image/jpeg,image/png,image/webp" required/></label><button type="submit" className={styles.secondary} disabled={busy}>Enviar imagem</button></form>
          {product.image_path && <button type="button" className={styles.danger} disabled={busy} onClick={() => void onRemoveImage()}><Trash2 size={14}/>Remover imagem</button>}
        </div>
      </div>
    </section>
  </div>;
}
