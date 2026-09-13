"use client";
import { FormEvent, useRef, useState } from "react";
import { LockKeyhole, ShieldCheck } from "lucide-react";
import { Brand } from "@/components/ui/brand";
import { formatCents } from "@/lib/operational";

type Offer = { slug: string; name: string; productName: string; description: string | null; priceCents: number; billingType: string };
export function CheckoutFlow({ offer, affiliate }: { offer: Offer; affiliate?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const key = useRef<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const data = new FormData(event.currentTarget);
    key.current ??= crypto.randomUUID();
    try {
      const response = await fetch("/api/checkout/orders", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key.current }, body: JSON.stringify({ offerSlug: offer.slug, customerName: data.get("name"), customerEmail: data.get("email"), refCode: affiliate }) });
      const result = await response.json();
      if (response.status === 409) key.current = crypto.randomUUID();
      if (!response.ok || !result.checkoutUrl) throw new Error(result.error || "Não foi possível abrir o pagamento.");
      window.location.assign(result.checkoutUrl);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha no pagamento."); setBusy(false); }
  }
  return <main className="checkout-page"><header className="checkout-header"><Brand href="/"/><span><LockKeyhole size={14}/> Ambiente seguro</span></header>
    <div className="checkout-layout"><section className="checkout-product"><span className="checkout-badge">{offer.productName}</span><h1>{offer.name}</h1><p>{offer.description}</p><div className="security-note"><ShieldCheck size={22}/><div><strong>Pagamento protegido</strong><span>Você será redirecionado para o Mercado Pago.</span></div></div></section>
    <section className="checkout-card"><div className="checkout-card-head"><div><span>Resumo do pedido</span><h2>{offer.name}</h2></div><div className="checkout-price"><strong>{formatCents(offer.priceCents)}</strong></div></div>
    {affiliate && <div className="referral-note">Indicação aplicada</div>}
    <form onSubmit={submit} className="checkout-form"><div className="checkout-divider"><span>Dados do comprador</span></div><label>Nome completo<input name="name" required autoComplete="name"/></label><label>E-mail<input name="email" type="email" required autoComplete="email"/></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="checkout-submit" disabled={busy}>{busy ? "Abrindo Mercado Pago..." : "Continuar para pagamento →"}</button></form><footer className="checkout-card-footer"><LockKeyhole size={13}/> Pagamento processado pelo Mercado Pago</footer></section></div></main>;
}
