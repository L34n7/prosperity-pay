"use client";
import Image from "next/image";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { AFFILIATE_HOLD_DAYS, calculateMaxInstallments } from "@/lib/domain/offer-rules";
import { formatCents, requestJson } from "@/lib/operational";
import { MAX_PRODUCT_IMAGE_BYTES, productImageUrl } from "@/lib/product-images";
type Product = { id: string; name: string; description: string | null; image_path: string | null; status: string; settlement_model: string };
type Offer = { id: string; name: string; price_cents: number; billing_type: string; status: string; checkout_slug: string; affiliate_commission_bps: number; max_installments: number };
const tabs = ["Visão geral", "Ofertas", "Checkout", "Afiliados", "Coprodutores", "Vendas", "Configurações"];
export function ProductDetail({ id }: { id: string }) {
 const [product, setProduct] = useState<Product | null>(null), [offers, setOffers] = useState<Offer[]>([]), [tab, setTab] = useState("Visão geral"), [error, setError] = useState(""), [message, setMessage] = useState(""), [busy, setBusy] = useState(false);
 const [newOfferPrice, setNewOfferPrice] = useState("");
 const load = useCallback(async () => { try { const [p,o] = await Promise.all([requestJson<{product: Product}>(`/api/products/${id}`), requestJson<{offers: Offer[]}>(`/api/products/${id}/offers`)]); setProduct(p.product); setOffers(o.offers); setError(""); } catch(cause) { setError(cause instanceof Error ? cause.message : "Erro ao carregar."); } },[id]);
 useEffect(() => { void Promise.resolve().then(load); },[load]);
 async function mutate(path: string, method: string, body: object) { setBusy(true); setError(""); setMessage(""); try { await requestJson(path, {method,body:JSON.stringify(body)}); await load(); setMessage("Alterações salvas."); } catch(cause) { setError(cause instanceof Error ? cause.message : "Erro ao salvar."); } finally {setBusy(false);} }
 async function createOffer(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = event.currentTarget; const d = new FormData(form); await mutate(`/api/products/${id}/offers`, "POST", {name:d.get("name"),priceCents:Math.round(Number(d.get("price"))*100),billingType:"one_time"}); form.reset(); setNewOfferPrice(""); }
 async function editProduct(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const d = new FormData(event.currentTarget); await mutate(`/api/products/${id}`, "PATCH", { name:d.get("name"), description:d.get("description"), status:d.get("status") }); }
 async function changeImage(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  const form = event.currentTarget;
  const file = new FormData(form).get("image");
  if (!(file instanceof File) || !file.size) { setError("Selecione uma imagem."); return; }
  if (file.size > MAX_PRODUCT_IMAGE_BYTES || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setError("Escolha uma imagem JPEG, PNG ou WebP com até 3 MB."); return; }
  setBusy(true); setError(""); setMessage("");
  try {
   const data = new FormData(); data.set("image", file);
   const response = await fetch(`/api/products/${id}/image`, { method:"POST", body:data });
   const result = await response.json();
   if (!response.ok) throw new Error(result.error || "Falha ao enviar imagem.");
   form.reset(); await load(); setMessage("Imagem salva.");
  } catch(cause) { setError(cause instanceof Error ? cause.message : "Falha ao enviar imagem."); }
  finally { setBusy(false); }
 }
 async function removeImage() {
  setBusy(true); setError(""); setMessage("");
  try {
   const response = await fetch(`/api/products/${id}/image`, { method:"DELETE" });
   const result = await response.json();
   if (!response.ok) throw new Error(result.error || "Falha ao remover imagem.");
   await load(); setMessage("Imagem removida.");
  } catch(cause) { setError(cause instanceof Error ? cause.message : "Falha ao remover imagem."); }
  finally { setBusy(false); }
 }
 const newOfferInstallments = calculateMaxInstallments(Math.round(Number(newOfferPrice || 0) * 100));
 return <><PageHeader title={product?.name ?? "Produto"} description={product?.settlement_model === "connected_account" ? "Recebimento direto no Mercado Pago" : "Recebimento no saldo Prosperity Pay"}/>
 <nav className="detail-tabs" aria-label="Gestão do produto">{tabs.map(item => <button key={item} className={tab === item ? "active" : ""} onClick={()=>setTab(item)}>{item}</button>)}</nav>
 {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success" role="status">{message}</p>}
 {!product ? <p>Carregando...</p> : <section className="panel operational-panel">
 {tab === "Visão geral" && <>{productImageUrl(product.image_path) && <Image className="product-detail-image" src={productImageUrl(product.image_path)!} alt={product.name} width={640} height={360} unoptimized/>}<h2>{product.name}</h2><p>{product.description || "Sem descrição."}</p><p>Status: {product.status} · {offers.length} ofertas</p><p>O modelo de recebimento foi definido na criação e não pode ser alterado.</p>{product.settlement_model === "connected_account" && <Link href="/integracoes">Ver conexão Mercado Pago →</Link>}</>}
 {tab === "Configurações" && <><form className="operational-form" onSubmit={editProduct}><label>Nome<input name="name" defaultValue={product.name} required minLength={2}/></label><label>Descrição<textarea name="description" defaultValue={product.description ?? ""}/></label><label>Status<select name="status" defaultValue={product.status}>{["draft","active","inactive","archived"].map(s=><option key={s} value={s}>{s}</option>)}</select></label><button className="primary-button" disabled={busy}>Salvar produto</button></form><div className="product-image-settings"><h2>Imagem do produto</h2>{productImageUrl(product.image_path) && <Image className="product-image-preview" src={productImageUrl(product.image_path)!} alt={product.name} width={320} height={180} unoptimized/>}<form className="operational-form" onSubmit={changeImage}><label>Selecionar imagem JPEG, PNG ou WebP (até 3 MB)<input type="file" name="image" accept="image/jpeg,image/png,image/webp" required/></label><button className="secondary-button" disabled={busy}>Enviar imagem</button></form>{product.image_path && <button className="secondary-button" disabled={busy} onClick={() => void removeImage()}>Remover imagem</button>}</div></>}
 {tab === "Ofertas" && <><h2>Ofertas</h2><form className="operational-form form-grid" onSubmit={createOffer}><label>Nome<input name="name" required minLength={2}/></label><label>Preço (R$)<input name="price" type="number" min="0.01" step="0.01" required onChange={e=>setNewOfferPrice(e.target.value)}/></label><div className="record-row"><strong>Parcelamento</strong><span>Até {newOfferInstallments}x · calculado automaticamente considerando parcela mínima de R$ 50.</span></div><div className="record-row"><strong>Liberação da comissão</strong><span>{AFFILIATE_HOLD_DAYS} dias após a aprovação · definido pela Prosperity Pay.</span></div><button className="primary-button" disabled={busy}>Criar oferta</button></form>{offers.map(offer => <div key={offer.id} className="offer-editor"><h3>{offer.name} · {formatCents(offer.price_cents)}</h3><form className="operational-form form-grid" onSubmit={e=>{e.preventDefault(); const d=new FormData(e.currentTarget); void mutate(`/api/products/${id}/offers/${offer.id}`,"PATCH",{name:d.get("name"),priceCents:Math.round(Number(d.get("price"))*100),status:d.get("status"),affiliateCommissionBps:Math.round(Number(d.get("commission"))*100)});}}><label>Nome<input name="name" defaultValue={offer.name} required/></label><label>Preço (R$)<input name="price" type="number" step="0.01" min="0.01" defaultValue={offer.price_cents/100} required/></label><label>Status<select name="status" defaultValue={offer.status}><option value="draft">Rascunho</option><option value="active">Ativa</option><option value="inactive">Inativa</option><option value="archived">Arquivada</option></select></label><label>Comissão padrão de afiliado (%)<input name="commission" type="number" min="0" max="100" step="0.01" defaultValue={offer.affiliate_commission_bps/100}/></label><div className="record-row"><strong>Parcelamento</strong><span>Até {offer.max_installments}x · calculado automaticamente considerando parcela mínima de R$ 50.</span></div><div className="record-row"><strong>Liberação da comissão</strong><span>{AFFILIATE_HOLD_DAYS} dias após a aprovação · definido pela Prosperity Pay.</span></div><button disabled={busy} className="secondary-button">Salvar oferta</button></form></div>)}</>}
 {tab === "Checkout" && <><h2>Links de checkout</h2>{offers.filter(o=>o.status==="active").length ? offers.filter(o=>o.status==="active").map(o=><div className="record-row" key={o.id}><strong>{o.name}</strong><Link href={`/checkout/${o.checkout_slug}`} target="_blank">Abrir checkout</Link><button className="secondary-button" onClick={async()=>{await navigator.clipboard.writeText(`${location.origin}/checkout/${o.checkout_slug}`); setMessage("Link copiado.");}}>Copiar link</button></div>) : <p>Ative uma oferta para gerar seu link.</p>}</>}
 {tab === "Afiliados" && <AffiliateManagement id={id}/>}
 {tab === "Coprodutores" && <CoproducerManagement id={id} offers={offers}/>}
 {tab === "Vendas" && <p>Consulte as vendas e os detalhes financeiros em <Link href="/pagamentos">Pagamentos →</Link></p>}
 </section>}</>;
}
function AffiliateManagement({id}:{id:string}) {
 const [mode,setMode]=useState("approval"),[active,setActive]=useState(false),[members,setMembers]=useState<{id:string;code:string;status:string;profiles:{full_name:string}}[]>([]),[error,setError]=useState("");
 useEffect(()=>{const run=async()=>{try{const data=await requestJson<{program:{mode:string;active:boolean}|null;memberships:typeof members}>(`/api/products/${id}/affiliates`);if(data.program){setMode(data.program.mode);setActive(data.program.active);}setMembers(data.memberships);}catch(cause){setError(String(cause));}};void run();},[id]);
 return <><h2>Programa de afiliados</h2><form className="operational-form" onSubmit={async e=>{e.preventDefault();try{await requestJson(`/api/products/${id}/affiliate-program`,{method:"PUT",body:JSON.stringify({mode,active,cookieDays:30})});setError("");}catch(cause){setError(String(cause));}}}><label>Modo<select value={mode} onChange={e=>setMode(e.target.value)}><option value="public">Público</option><option value="approval">Sob aprovação</option><option value="invite">Convite</option></select></label><label><input type="checkbox" checked={active} onChange={e=>setActive(e.target.checked)}/> Programa ativo</label><button className="primary-button">Salvar programa</button></form>{error && <p className="form-error">{error}</p>}{members.map(m=><div className="record-row" key={m.id}>{m.profiles?.full_name} · {m.code} · {m.status}{m.status==="pending" && <button className="secondary-button" onClick={async()=>{await requestJson(`/api/products/${id}/affiliates/${m.id}`,{method:"PATCH",body:JSON.stringify({status:"active"})});setMembers(items=>items.map(item=>item.id===m.id?{...item,status:"active"}:item));}}>Aprovar</button>}</div>)}</>;
}
function CoproducerManagement({id,offers}:{id:string;offers:Offer[]}) {
 const [link,setLink]=useState(""),[error,setError]=useState("");
 const [invitations,setInvitations]=useState<{id:string;invited_email:string;participation_bps:number;status:string}[]>([]);
 const [participants,setParticipants]=useState<{id:string;user_id:string;participation_bps:number;active:boolean}[]>([]);
 const load=useCallback(async()=>{try{const data=await requestJson<{invitations:typeof invitations;participants:typeof participants}>(`/api/products/${id}/coproducers/invitations`);setInvitations(data.invitations);setParticipants(data.participants);}catch(cause){setError(String(cause));}},[id]);
 useEffect(()=>{void Promise.resolve().then(load);},[load]);
 return <><h2>Convidar coprodutor</h2><form className="operational-form form-grid" onSubmit={async e=>{e.preventDefault();const d=new FormData(e.currentTarget);try{const result=await requestJson<{invitationUrl:string}>(`/api/products/${id}/coproducers/invitations`,{method:"POST",body:JSON.stringify({email:d.get("email"),participationBps:Math.round(Number(d.get("share"))*100),offerId:d.get("offerId")||undefined})});setLink(result.invitationUrl);setError("");await load();}catch(cause){setError(String(cause));}}}><label>E-mail<input name="email" type="email" required/></label><label>Participação (%)<input name="share" type="number" min="0.01" max="100" step="0.01" required/></label><label>Aplicação<select name="offerId"><option value="">Produto inteiro</option>{offers.map(o=><option value={o.id} key={o.id}>{o.name}</option>)}</select></label><button className="primary-button">Criar convite</button></form>{link && <p>Envie este link ao convidado: <button className="secondary-button" onClick={()=>navigator.clipboard.writeText(link)}>Copiar convite</button></p>}{error && <p className="form-error">{error}</p>}
 <h3>Convites</h3>{invitations.length?invitations.map(item=><div className="record-row" key={item.id}><strong>{item.invited_email}</strong><span>{item.participation_bps/100}% · {item.status}</span></div>):<p>Nenhum convite.</p>}
 <h3>Participações ativas</h3>{participants.filter(p=>p.active).length?participants.filter(p=>p.active).map(item=><div className="record-row" key={item.id}><strong>{item.user_id}</strong><span>{item.participation_bps/100}%</span></div>):<p>Nenhuma participação ativa.</p>}</>;
}
