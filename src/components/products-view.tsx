"use client";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { requestJson } from "@/lib/operational";
type Product = { id: string; name: string; description: string | null; status: string; settlement_model: string };
export function ProductsView() {
 const [products, setProducts] = useState<Product[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState(""), [busy, setBusy] = useState(false);
 const load = useCallback(async () => { try { const result = await requestJson<{products: Product[]}>("/api/products"); setProducts(result.products); setError(""); } catch (cause) { setError(String(cause)); } finally { setLoading(false); } }, []);
 useEffect(() => { void Promise.resolve().then(load); }, [load]);
 async function create(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); setError(""); const data = new FormData(event.currentTarget);
  try { await requestJson("/api/products", { method: "POST", body: JSON.stringify({ name: data.get("name"), description: data.get("description"), settlementModel: data.get("settlementModel") }) }); event.currentTarget.reset(); await load(); } catch(cause) { setError(cause instanceof Error ? cause.message : "Erro ao criar produto."); } finally { setBusy(false); }
 }
 return <><PageHeader title="Produtos" description="Cadastre produtos e configure ofertas para vender."/>
 <section className="panel operational-panel"><h2>Novo produto</h2><form className="operational-form form-grid" onSubmit={create}>
 <label>Nome<input name="name" minLength={2} maxLength={180} required/></label><label>Modelo de recebimento<select name="settlementModel"><option value="connected_account">Receber diretamente no Mercado Pago</option><option value="prosperity_balance">Receber como saldo no Prosperity Pay</option></select></label>
 <label className="form-wide">Descrição<textarea name="description" rows={2} maxLength={4000}/></label><button className="primary-button" disabled={busy}>{busy ? "Salvando..." : "Novo produto"}</button></form></section>
 {error && <p className="form-error" role="alert">{error}</p>}{loading ? <p>Carregando produtos...</p> : !products.length ? <section className="panel operational-panel"><p>Você ainda não cadastrou produtos.</p></section> : <section className="panel operational-panel"><h2>Seus produtos</h2><div className="records-list">{products.map(product => <Link className="record-row" href={`/produtos/${product.id}`} key={product.id}><strong>{product.name}</strong><span>{product.settlement_model === "connected_account" ? "Mercado Pago" : "Saldo Prosperity"} · {product.status}</span><span>Gerenciar →</span></Link>)}</div></section>}</>;
}
