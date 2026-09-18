"use client";

import Link from "next/link";
import { Check, ExternalLink, Handshake } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { requestJson } from "@/lib/operational";

export function AffiliateProgramJoin({ programId, productName, mode, terms, supportEmail, landingPageUrl }: {
  programId: string;
  productName: string;
  mode: "public" | "approval";
  terms: string | null;
  supportEmail: string | null;
  landingPageUrl: string | null;
}) {
  const [accepted, setAccepted] = useState(!terms);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function join() {
    setBusy(true); setError("");
    try {
      await requestJson(`/api/affiliate-programs/${programId}/join`, { method: "POST", body: "{}" });
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao solicitar afiliação.");
    } finally { setBusy(false); }
  }

  return <>
    <PageHeader title="Programa de afiliados" description={`Convite para promover ${productName}.`}/>
    <section className="panel operational-panel" style={{ maxWidth: 760 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <span style={{ display:"grid", width:42, height:42, placeItems:"center", border:"1px solid rgba(34,230,161,.18)", borderRadius:11, color:"var(--primary)" }}><Handshake size={21}/></span>
        <div><h2 style={{ margin: 0 }}>{productName}</h2><p style={{ margin: "4px 0 0", color:"var(--text-muted)" }}>{mode === "public" ? "Entrada automática no programa." : "Sua solicitação será analisada pelo produtor."}</p></div>
      </div>
      {landingPageUrl && <p><a href={landingPageUrl} target="_blank" rel="noreferrer">Ver página com mais informações <ExternalLink size={13}/></a></p>}
      {terms && <div style={{ margin:"14px 0", padding:14, border:"1px solid rgba(92,133,111,.16)", borderRadius:10 }}>
        <strong>Termos do programa</strong>
        <p style={{ color:"var(--text-muted)", lineHeight:1.55, whiteSpace:"pre-wrap" }}>{terms}</p>
        <label style={{ display:"flex", gap:8, alignItems:"center" }}><input type="checkbox" checked={accepted} onChange={event=>setAccepted(event.target.checked)}/> Li e aceito os termos do programa.</label>
      </div>}
      {supportEmail && <p style={{ color:"var(--text-subtle)" }}>Suporte aos afiliados: {supportEmail}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {done
        ? <p className="form-success"><Check size={15}/> {mode === "public" ? "Afiliação ativada. Seus links já estão disponíveis." : "Solicitação enviada. Aguarde a aprovação do produtor."} <Link href="/afiliados">Abrir Minhas afiliações</Link></p>
        : <button className="primary-button" disabled={busy || !accepted} onClick={()=>void join()}>{busy ? "Enviando..." : mode === "public" ? "Participar do programa" : "Solicitar afiliação"}</button>}
    </section>
  </>;
}
