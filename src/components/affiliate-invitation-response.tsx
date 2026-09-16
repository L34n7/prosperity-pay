"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, Handshake, XCircle } from "lucide-react";
import { requestJson } from "@/lib/operational";

export function AffiliateInvitationResponse({ code }: { code: string }) {
  const [status, setStatus] = useState<"idle" | "accepted" | "rejected">("idle");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function respond(action: "accept" | "reject") {
    setBusy(true);
    setMessage("");
    try {
      await requestJson("/api/affiliate-invitations/respond", {
        method: "POST",
        body: JSON.stringify({ code, action }),
      });
      setStatus(action === "accept" ? "accepted" : "rejected");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Falha ao responder ao convite.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="auth-page">
    <section className="auth-card">
      <div style={{ display: "grid", placeItems: "center", marginBottom: 16, color: "var(--primary)" }}><Handshake size={34}/></div>
      <h1>Convite para afiliação</h1>
      {status === "accepted" ? <>
        <p role="status"><CheckCircle2 size={16} style={{ verticalAlign: "middle", marginRight: 6 }}/>Convite aceito. Sua afiliação está ativa.</p>
        <Link className="primary-button" href="/afiliados">Ir para meus afiliados</Link>
      </> : status === "rejected" ? <p role="status"><XCircle size={16} style={{ verticalAlign: "middle", marginRight: 6 }}/>Convite recusado.</p> : code ? <>
        <p>Ao aceitar, você passa a participar do programa deste produto e recebe seu código de afiliado.</p>
        {message && <p className="form-error" role="alert">{message}</p>}
        <div className="button-row">
          <button className="primary-button" disabled={busy} onClick={() => void respond("accept")}>{busy ? "Processando..." : "Aceitar convite"}</button>
          <button className="secondary-button" disabled={busy} onClick={() => void respond("reject")}>Recusar</button>
        </div>
      </> : <p>Convite inválido.</p>}
    </section>
  </main>;
}
