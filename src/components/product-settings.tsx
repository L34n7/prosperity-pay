"use client";

import Image from "next/image";
import { FormEvent, useState } from "react";
import { AlertTriangle, ExternalLink, ImageIcon, LifeBuoy, Link2, Package, ReceiptText, Save, Trash2, Upload } from "lucide-react";
import { PRODUCT_CATEGORIES, RECURRENCE_OPTIONS, type ProductPaymentType, type RecurrenceFrequency } from "@/lib/domain/product-rules";
import { productImageUrl } from "@/lib/product-images";
import styles from "./product-settings.module.css";

type Product = {
  id: string;
  name: string;
  description: string | null;
  post_purchase_message: string | null;
  post_purchase_redirect_url: string | null;
  affiliate_funnel_base_url: string | null;
  image_path: string | null;
  status: string;
  payment_type: ProductPaymentType;
  billing_model: "prepaid" | "postpaid";
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
  automatic_due_billing_enabled: boolean;
};

type Props = {
  product: Product;
  busy: boolean;
  onSave: (body: object) => Promise<boolean>;
  onChangeImage: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onRemoveImage: () => Promise<void>;
  onDelete: () => void;
};

function moneyInput(cents: number | null | undefined) {
  return cents == null ? "" : (cents / 100).toFixed(2);
}

function cents(value: FormDataEntryValue | null) {
  return Math.round(Number(value) * 100);
}

export function ProductSettings({ product, busy, onSave, onChangeImage, onRemoveImage, onDelete }: Props) {
  const [active, setActive] = useState(product.status === "active");
  const [automaticDueBillingEnabled, setAutomaticDueBillingEnabled] =
    useState(product.automatic_due_billing_enabled === true);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await onSave({
      name: data.get("name"),
      description: data.get("description"),
      postPurchaseMessage: data.get("postPurchaseMessage"),
      postPurchaseRedirectUrl: data.get("postPurchaseRedirectUrl"),
      affiliateFunnelBaseUrl: data.get("affiliateFunnelBaseUrl"),
      status: active ? "active" : "inactive",
      paymentType: product.payment_type,
      billingModel: product.billing_model,
      productType: data.get("productType"),
      category: data.get("category"),
      supportDisplayName: data.get("supportDisplayName"),
      supportEmail: data.get("supportEmail"),
      supportWhatsapp: data.get("supportWhatsapp"),
      recurrenceFrequency: product.payment_type === "recurring" ? data.get("recurrenceFrequency") : null,
      differentFirstCharge: product.different_first_charge,
      firstChargeCents: product.different_first_charge ? product.first_charge_cents : null,
      recurringPriceCents: product.payment_type === "recurring" ? cents(data.get("recurringPrice")) : null,
      mainOfferPriceCents: product.payment_type === "one_time" ? cents(data.get("mainOfferPrice")) : null,
      automaticDueBillingEnabled:
        product.payment_type === "recurring" && automaticDueBillingEnabled,
    });
  }

  const imageUrl = productImageUrl(product.image_path);

  return <div className={styles.shell}>
    <section className={styles.hero}>
      <div className={styles.heroIcon}><Package size={19}/></div>
      <div><small>Produto</small><h2>Configurações</h2><p>Organize informações comerciais, cobrança e dados de atendimento.</p></div>
    </section>

    <form id="product-settings-form" className={styles.form} onSubmit={submit}>
      <section className={styles.card}>
        <div className={styles.cardHeader}><div><span><Package size={16}/></span><div><h3>Informações principais</h3><p>Dados que identificam o produto dentro da plataforma.</p></div></div></div>
        <div className={styles.stack}>
          <label className={styles.field}><span>Nome</span><input name="name" defaultValue={product.name} required minLength={2}/></label>
          <label className={styles.field}><span>Descrição interna <small className={styles.labelHint}>(Essa descrição não é exibida para os clientes)</small></span><textarea name="description" defaultValue={product.description ?? ""} rows={4} placeholder="Use este campo para observações internas sobre o produto."/></label>
          <div className={styles.gridThree}>
            <div className={styles.statusField}>
              <span>Status</span>
              <div className={styles.statusControl}>
                <button type="button" className={`${styles.switch} ${active ? styles.switchOn : ""}`} role="switch" aria-checked={active} aria-label={active ? "Desativar produto" : "Ativar produto"} onClick={() => setActive(value => !value)}><span/></button>
                <div><strong>{active ? "Ativo" : "Inativo"}</strong><small>{active ? "Disponível para vendas nas ofertas ativas." : "Vendas do produto ficam desativadas."}</small></div>
              </div>
            </div>
            <label className={styles.field}><span>Tipo de produto</span><select name="productType" defaultValue={product.product_type}><option value="digital">Digital</option><option value="physical">Físico</option></select></label>
            <label className={styles.field}><span>Categoria</span><select name="category" defaultValue={PRODUCT_CATEGORIES.includes(product.category as typeof PRODUCT_CATEGORIES[number]) ? product.category ?? "" : ""}><option value="">Selecione</option>{PRODUCT_CATEGORIES.map(category => <option key={category} value={category}>{category}</option>)}</select></label>
          </div>
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}><div><span><ReceiptText size={16}/></span><div><h3>Cobrança</h3><p>Defina o modelo principal usado pelas ofertas deste produto.</p></div></div></div>
        <div className={styles.gridTwo}>
          <label className={styles.field}><span>Tipo de pagamento</span><select value={product.payment_type} disabled><option value="one_time">Pagamento único</option><option value="recurring">Assinatura pré-paga</option></select></label>
          {product.payment_type === "recurring"
            ? <label className={styles.field}><span>Mensalidade padrão</span><div className={styles.money}><small>R$</small><input name="recurringPrice" type="number" min="0.01" step="0.01" defaultValue={moneyInput(product.recurring_price_cents)} required/></div></label>
            : <label className={styles.field}><span>Preço padrão do produto</span><div className={styles.money}><small>R$</small><input name="mainOfferPrice" type="number" min="0.01" step="0.01" defaultValue={moneyInput(product.main_offer_price_cents)} required/></div></label>}
          {product.payment_type === "recurring" && <label className={styles.field}><span>Ciclo da assinatura</span><select name="recurrenceFrequency" defaultValue={product.recurrence_frequency ?? "monthly"}>{RECURRENCE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>}
          {product.payment_type === "recurring" && <label className={styles.field}><span>Modelo de cobrança</span><select value="prepaid" disabled><option value="prepaid">Pré-pago</option></select></label>}
        </div>
        <p className={styles.hint}>{product.payment_type === "recurring" ? "A assinatura é pré-paga: pagamento aprovado libera o ciclo; upgrades e novos adicionais cobram somente o proporcional restante. O modelo pós-pago ficará disponível futuramente." : "O valor efetivamente cobrado no checkout é o preço configurado em cada oferta."}</p>

        {product.payment_type === "recurring" && (
          <div className={styles.statusField}>
            <span>Cobrança automática no vencimento</span>
            <div className={styles.statusControl}>
              <button
                type="button"
                className={`${styles.switch} ${automaticDueBillingEnabled ? styles.switchOn : ""}`}
                role="switch"
                aria-checked={automaticDueBillingEnabled}
                aria-label={
                  automaticDueBillingEnabled
                    ? "Desativar cobrança automática"
                    : "Ativar cobrança automática"
                }
                onClick={() =>
                  setAutomaticDueBillingEnabled((value) => !value)
                }
              >
                <span />
              </button>
              <div>
                <strong>
                  {automaticDueBillingEnabled ? "Ativada" : "Desativada"}
                </strong>
                <small>
                  Quando ativada, a Prosperity Pay gera o PIX no vencimento e envia ao cliente um e-mail com composição, PIX Copia e Cola e link para pagamento por cartão.
                </small>
              </div>
            </div>
          </div>
        )}
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
        <div className={styles.cardHeader}><div><span><Link2 size={16}/></span><div><h3>Divulgação por afiliados</h3><p>Defina o início do funil que será usado como link principal pelos afiliados deste produto.</p></div></div></div>
        <div className={styles.stack}>
          <label className={styles.field}>
            <span>URL principal de divulgação para afiliados</span>
            <input name="affiliateFunnelBaseUrl" type="url" defaultValue={product.affiliate_funnel_base_url ?? ""} maxLength={2048} placeholder="https://seusite.com/comecar?ref="/>
          </label>
          <p className={styles.hint}>Informe a URL do início do funil terminando em <strong>?ref=</strong> ou <strong>&amp;ref=</strong>. O Prosperity Pay adicionará automaticamente o código único do afiliado ao final. Ex.: <strong>https://seusite.com/comecar?ref=</strong></p>
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

    <div className={`${styles.actions} ${styles.actionsAfterImage}`}><button type="submit" form="product-settings-form" className={styles.save} disabled={busy}><Save size={15}/>{busy ? "Salvando..." : "Salvar configurações"}</button></div>

    <section className={`${styles.card} ${styles.dangerCard}`}>
      <div className={styles.cardHeader}><div><span className={styles.dangerIcon}><AlertTriangle size={16}/></span><div><h3>Excluir produto</h3><p>Remova definitivamente este produto e as configurações vinculadas a ele.</p></div></div></div>
      <div className={styles.dangerZone}>
        <div><strong>Esta ação é permanente.</strong><small>Antes de excluir, você verá exatamente o que será impactado e precisará confirmar a operação.</small></div>
        <button type="button" className={styles.deleteProduct} disabled={busy} onClick={onDelete}><Trash2 size={14}/>Excluir produto</button>
      </div>
    </section>
  </div>;
}
