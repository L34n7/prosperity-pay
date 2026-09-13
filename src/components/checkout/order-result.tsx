"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
export function OrderResult({ orderId }: { orderId?: string }) {
  const [status, setStatus] = useState("consultando");
  useEffect(() => {
    if (!orderId) { return; }
    let active = true;
    async function poll() {
      try { const response = await fetch(`/api/checkout/orders/${encodeURIComponent(orderId!)}`, { cache: "no-store" }); const result = await response.json(); if (active) setStatus(response.ok ? result.status : "indisponivel"); }
      catch { if (active) setStatus("indisponivel"); }
    }
    void poll(); const timer = window.setInterval(poll, 10000);
    return () => { active = false; window.clearInterval(timer); };
  }, [orderId]);
  const labels: Record<string, string> = { consultando: "Consultando o pedido...", draft: "Preparando o pagamento", pending_payment: "Aguardando confirmação do pagamento", paid: "Pagamento confirmado", cancelled: "Pedido cancelado", expired: "Pedido expirado", refunded: "Pagamento estornado", charged_back: "Pagamento contestado", indisponivel: "Não foi possível consultar o pedido" };
  return <main className="auth-page"><div className="auth-card"><h1>Status do pedido</h1><p role="status">{orderId ? labels[status] ?? status : "Pedido não informado."}</p><p>A confirmação é feita pelo Mercado Pago. Esta página é atualizada automaticamente.</p><Link href="/login">Ir para minha conta</Link></div></main>;
}
