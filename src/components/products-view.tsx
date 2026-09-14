"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { requestJson } from "@/lib/operational";
import { MAX_PRODUCT_IMAGE_BYTES, productImageUrl } from "@/lib/product-images";

type Product = { id: string; name: string; image_path: string | null; status: string; settlement_model: string };

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

  function closeDialog() {
    dialog.current?.close();
    selectImage(null);
    setDialogError("");
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
      const result = await requestJson<{ product: Product }>("/api/products", {
        method: "POST",
        body: JSON.stringify({ name: data.get("name"), description: data.get("description"), settlementModel: data.get("settlementModel") }),
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
    <PageHeader title="Produtos" description="Cadastre produtos e configure ofertas para vender."
      action={<button className="primary-button" onClick={() => { setDialogError(""); dialog.current?.showModal(); }}>Novo produto</button>}/>
    {notice && <p className="form-success" role="status">{notice}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {loading ? <p>Carregando produtos...</p> : !products.length ?
      <section className="panel operational-panel"><p>Você ainda não cadastrou produtos. Crie seu primeiro produto para configurar uma oferta.</p></section> :
      <section className="panel operational-panel"><h2>Seus produtos</h2><div className="records-list">{products.map(product =>
        <Link className="record-row product-record" href={`/produtos/${product.id}`} key={product.id}>
          {productImageUrl(product.image_path) && <Image className="product-thumb" src={productImageUrl(product.image_path)!} alt="" width={56} height={56} unoptimized/>}
          <strong>{product.name}</strong>
          <span>{product.settlement_model === "connected_account" ? "Mercado Pago" : "Saldo Prosperity"} · {product.status}</span>
          <span>Gerenciar →</span>
        </Link>)}</div></section>}

    <dialog ref={dialog} className="product-dialog" aria-labelledby="product-dialog-title" onCancel={event => { if (busy) event.preventDefault(); }} onClose={() => { selectImage(null); setDialogError(""); }}>
      <div className="product-dialog-heading"><div><h2 id="product-dialog-title">Novo produto</h2><p>Preencha os dados e adicione uma imagem, se desejar.</p></div>
        <button type="button" className="secondary-button" aria-label="Fechar" disabled={busy} onClick={closeDialog}>Fechar</button></div>
      <form className="operational-form" onSubmit={create}>
        <label>Nome<input name="name" minLength={2} maxLength={180} required autoFocus/></label>
        <label>Modelo de recebimento<select name="settlementModel"><option value="connected_account">Receber diretamente no Mercado Pago</option><option value="prosperity_balance">Receber como saldo no Prosperity Pay</option></select></label>
        <label>Descrição<textarea name="description" rows={3} maxLength={4000}/></label>
        <label>Imagem (opcional, até 3 MB)<input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => selectImage(event.currentTarget.files?.[0] ?? null)}/></label>
        {preview && <Image className="product-image-preview" src={preview} alt="Prévia da imagem do produto" width={320} height={180} unoptimized/>}
        {dialogError && <p className="form-error" role="alert">{dialogError}</p>}
        <div className="product-dialog-actions"><button type="button" className="secondary-button" disabled={busy} onClick={closeDialog}>Cancelar</button><button className="primary-button" disabled={busy}>{busy ? "Salvando..." : "Criar produto"}</button></div>
      </form>
    </dialog>
  </>;
}
