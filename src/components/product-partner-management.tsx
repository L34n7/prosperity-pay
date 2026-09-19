"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  BadgePercent,
  Check,
  Copy,
  Handshake,
  Link2,
  MailPlus,
  ShieldCheck,
  UserPlus,
  UsersRound,
} from "lucide-react";
import { requestJson } from "@/lib/operational";
import styles from "./product-partner-management.module.css";

type AffiliateMode = "public" | "approval" | "invite";
type AffiliateProgram = { id: string; mode: AffiliateMode; active: boolean; cookie_days: number };
type AffiliateMember = {
  id: string;
  code: string;
  status: string;
  created_at?: string;
  profiles: { full_name: string; email: string } | null;
};
type OfferOption = { id: string; name: string };
type CoproducerInvitation = {
  id: string;
  invited_email: string;
  participation_bps: number;
  status: string;
  expires_at?: string;
  offer_id?: string | null;
};
type CoproducerParticipant = {
  id: string;
  user_id: string;
  participation_bps: number;
  active: boolean;
  offer_id?: string | null;
  profiles?: { full_name: string; email: string } | null;
};

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`${styles.switch} ${checked ? styles.switchOn : ""}`} onClick={() => onChange(!checked)}><span/></button>;
}

function StatusBadge({ status }: { status: string }) {
  const active = status === "active" || status === "accepted";
  const pending = status === "pending";
  const label: Record<string, string> = { active: "Ativo", accepted: "Aceito", pending: "Pendente", rejected: "Recusado", blocked: "Bloqueado", cancelled: "Cancelado", expired: "Expirado" };
  return <span className={`${styles.badge} ${active ? styles.badgeActive : pending ? styles.badgePending : ""}`}>{label[status] ?? status}</span>;
}

async function copy(text: string) {
  await navigator.clipboard.writeText(text);
}

export function ProductAffiliateManagement({ id }: { id: string }) {
  const [program, setProgram] = useState<AffiliateProgram | null>(null);
  const [mode, setMode] = useState<AffiliateMode>("approval");
  const [active, setActive] = useState(false);
  const [members, setMembers] = useState<AffiliateMember[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [inviteUrl, setInviteUrl] = useState("");
  const [copied, setCopied] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await requestJson<{ program: AffiliateProgram | null; memberships: AffiliateMember[] }>(`/api/products/${id}/affiliates`);
      setProgram(data.program);
      if (data.program) { setMode(data.program.mode); setActive(data.program.active); }
      setMembers(data.memberships ?? []);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao carregar afiliados.");
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  async function saveProgram() {
    setBusy(true); setError(""); setMessage("");
    try {
      await requestJson(`/api/products/${id}/affiliate-program`, { method: "PUT", body: JSON.stringify({ mode, active, cookieDays: 30 }) });
      setMessage("Programa de afiliados atualizado.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao salvar o programa.");
    } finally { setBusy(false); }
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const email = new FormData(form).get("email");
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await requestJson<{ invitationPath: string }>(`/api/products/${id}/affiliates/invite`, { method: "POST", body: JSON.stringify({ email }) });
      const full = `${location.origin}${result.invitationPath}`;
      setInviteUrl(full);
      setMessage("Convite criado. Envie o link ao afiliado.");
      form.reset();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao criar convite.");
    } finally { setBusy(false); }
  }

  async function setMemberStatus(memberId: string, status: "active" | "blocked") {
    setBusy(true); setError("");
    try {
      await requestJson(`/api/products/${id}/affiliates/${memberId}`, { method: "PATCH", body: JSON.stringify({ status }) });
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao atualizar afiliado."); }
    finally { setBusy(false); }
  }

  async function copyInvite(member: AffiliateMember) {
    const url = `${location.origin}/convites/afiliacao?code=${encodeURIComponent(member.code)}`;
    await copy(url); setCopied(member.id); setTimeout(() => setCopied(""), 1200);
  }

  const inviteReady = program?.active && program.mode === "invite";
  const activeCount = members.filter(item => item.status === "active").length;
  const pendingCount = members.filter(item => item.status === "pending").length;

  return <div className={styles.shell}>
    <section className={styles.hero}>
      <div className={styles.heroTitle}><div className={styles.heroIcon}><UsersRound size={19}/></div><div><small>Parcerias</small><h2>Programa de afiliados</h2><p>Controle como novos afiliados entram e acompanhe quem já participa do produto.</p></div></div>
      <div className={styles.statusBox}><span><strong>{active ? "Programa ativo" : "Programa pausado"}</strong><small>{activeCount} ativos · {pendingCount} pendentes</small></span><Switch checked={active} onChange={setActive} label="Ativar programa de afiliados"/></div>
    </section>

    {error && <p className={styles.error} role="alert">{error}</p>}
    {message && <p className={styles.success} role="status">{message}</p>}

    <section className={styles.card}>
      <div className={styles.cardHeader}><div><span><ShieldCheck size={16}/></span><div><h3>Entrada de afiliados</h3><p>Escolha como uma pessoa pode participar deste programa.</p></div></div></div>
      <div className={styles.modeSelector}>
        <button type="button" className={`${styles.modeButton} ${mode === "public" ? styles.modeActive : ""}`} onClick={() => setMode("public")}><strong>Público</strong><small>Entra automaticamente ao solicitar afiliação.</small></button>
        <button type="button" className={`${styles.modeButton} ${mode === "approval" ? styles.modeActive : ""}`} onClick={() => setMode("approval")}><strong>Sob aprovação</strong><small>Solicitações aguardam aprovação do produtor.</small></button>
        <button type="button" className={`${styles.modeButton} ${mode === "invite" ? styles.modeActive : ""}`} onClick={() => setMode("invite")}><strong>Somente convite</strong><small>Apenas usuários convidados pelo produtor podem entrar.</small></button>
      </div>
      <div className={styles.configFooter}><span className={styles.meta}>Atribuição padrão: 30 dias após o clique.</span><button type="button" className={styles.primary} disabled={busy} onClick={() => void saveProgram()}>{busy ? "Salvando..." : "Salvar configuração"}</button></div>
    </section>

    {mode === "invite" && <section className={styles.card}>
      <div className={styles.cardHeader}><div><span><MailPlus size={16}/></span><div><h3>Convidar afiliado</h3><p>O convidado precisa ter uma conta Prosperity Pay com o e-mail informado.</p></div></div></div>
      {inviteReady ? <form className={styles.inviteGrid} onSubmit={invite}><label className={styles.field}>E-mail do afiliado<input name="email" type="email" placeholder="afiliado@exemplo.com" required/></label><button className={styles.primary} disabled={busy}><UserPlus size={15}/>{busy ? "Criando..." : "Criar convite"}</button></form> : <p className={styles.notice}>Salve o programa como <strong>ativo</strong> no modo <strong>Somente convite</strong> para liberar convites.</p>}
      {inviteUrl && <div className={styles.linkBox}><Link2 size={15}/><code>{inviteUrl}</code><button type="button" className={styles.secondary} onClick={() => void copy(inviteUrl)}><Copy size={14}/>Copiar</button></div>}
    </section>}

    <section className={styles.card}>
      <div className={styles.sectionTitle}><h3>Afiliados do produto</h3><small>{members.length} registro{members.length === 1 ? "" : "s"}</small></div>
      {members.length ? <div className={styles.list}>{members.map(member => <div className={styles.row} key={member.id}>
        <div className={styles.identity}><strong>{member.profiles?.full_name || "Afiliado"}</strong><small>{member.profiles?.email || "Conta vinculada"}</small></div>
        <code className={styles.code}>{member.code}</code>
        <StatusBadge status={member.status}/>
        <div className={styles.rowActions}>
          {member.status === "pending" && program?.mode === "approval" && <button type="button" className={styles.secondary} disabled={busy} onClick={() => void setMemberStatus(member.id, "active")}><Check size={14}/>Aprovar</button>}
          {member.status === "pending" && program?.mode === "invite" && <button type="button" className={styles.secondary} onClick={() => void copyInvite(member)}>{copied === member.id ? <Check size={14}/> : <Copy size={14}/>}Convite</button>}
          {member.status === "active" && <button type="button" className={styles.danger} disabled={busy} onClick={() => void setMemberStatus(member.id, "blocked")}>Bloquear</button>}
        </div>
      </div>)}</div> : <div className={styles.empty}>Nenhum afiliado vinculado a este produto ainda.</div>}
    </section>
  </div>;
}

export function ProductCoproducerManagement({ id, offers }: { id: string; offers: OfferOption[] }) {
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invitations, setInvitations] = useState<CoproducerInvitation[]>([]);
  const [participants, setParticipants] = useState<CoproducerParticipant[]>([]);

  const load = useCallback(async () => {
    try {
      const data = await requestJson<{ invitations: CoproducerInvitation[]; participants: CoproducerParticipant[] }>(`/api/products/${id}/coproducers/invitations`);
      setInvitations(data.invitations ?? []); setParticipants(data.participants ?? []); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao carregar coprodutores."); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  function offerName(offerId?: string | null) {
    return offerId ? offers.find(offer => offer.id === offerId)?.name ?? "Oferta específica" : "Produto inteiro";
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await requestJson<{ invitationUrl: string }>(`/api/products/${id}/coproducers/invitations`, { method: "POST", body: JSON.stringify({ email: data.get("email"), participationBps: Math.round(Number(data.get("share")) * 100), offerId: data.get("offerId") || undefined }) });
      setLink(result.invitationUrl); setMessage("Convite de coprodução criado."); form.reset(); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao criar convite."); }
    finally { setBusy(false); }
  }

  const activeParticipants = participants.filter(item => item.active);

  return <div className={styles.shell}>
    <section className={styles.hero}>
      <div className={styles.heroTitle}><div className={styles.heroIcon}><Handshake size={19}/></div><div><small>Parcerias</small><h2>Co-Produtores</h2><p>Divida a participação financeira do produto ou de uma oferta específica com parceiros.</p></div></div>
      <div className={styles.heroActions}>
        <button type="button" className={styles.primary} onClick={()=>setInviteOpen(true)}><UserPlus size={15}/>Convidar Co-Produtor</button>
        <div className={styles.statusBox}><span><strong>{activeParticipants.length} co-produtor{activeParticipants.length === 1 ? "" : "es"}</strong><small>{invitations.filter(item => item.status === "pending").length} convite(s) pendente(s)</small></span><BadgePercent size={18}/></div>
      </div>
    </section>

    {error && <p className={styles.error} role="alert">{error}</p>}
    {message && <p className={styles.success} role="status">{message}</p>}

    <section className={styles.card}>
      <div className={styles.sectionTitle}><h3>Coprodutores ativos</h3><small>{activeParticipants.length}</small></div>
      {activeParticipants.length ? <div className={styles.list}>{activeParticipants.map(item => <div className={styles.row} key={item.id}>
        <div className={styles.identity}><strong>{item.profiles?.full_name || "Coprodutor"}</strong><small>{item.profiles?.email || item.user_id}</small></div>
        <span className={styles.detail}>{offerName(item.offer_id)}</span>
        <span className={`${styles.badge} ${styles.badgeActive}`}>{item.participation_bps / 100}%</span>
        <div className={styles.rowActions}/>
      </div>)}</div> : <div className={styles.empty}>Nenhum coprodutor ativo neste produto.</div>}
    </section>

    <section className={styles.card}>
      <div className={styles.sectionTitle}><h3>Histórico de convites</h3><small>{invitations.length}</small></div>
      {invitations.length ? <div className={styles.list}>{invitations.map(item => <div className={styles.row} key={item.id}>
        <div className={styles.identity}><strong>{item.invited_email}</strong><small>{offerName(item.offer_id)}</small></div>
        <span className={styles.detail}>{item.participation_bps / 100}% de participação</span>
        <StatusBadge status={item.status}/>
        <div className={styles.rowActions}/>
      </div>)}</div> : <div className={styles.empty}>Nenhum convite de coprodução enviado ainda.</div>}
    </section>
    {inviteOpen&&<CoproducerInviteDialog offers={offers} busy={busy} link={link} copied={copied} error={error} message={message} onInvite={invite} onCopy={async()=>{await copy(link);setCopied(true);setTimeout(()=>setCopied(false),1200);}} onClose={()=>setInviteOpen(false)}/>}
  </div>;
}

function CoproducerInviteDialog({offers,busy,link,copied,error,message,onInvite,onCopy,onClose}:{offers:OfferOption[];busy:boolean;link:string;copied:boolean;error:string;message:string;onInvite:(event:FormEvent<HTMLFormElement>)=>Promise<void>;onCopy:()=>Promise<void>;onClose:()=>void}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{ref.current?.showModal();},[]);
  return <dialog ref={ref} className={styles.inviteDialog} onClose={onClose} onCancel={event=>{if(busy)event.preventDefault();}}>
    <header className={styles.inviteModalHeader}><div><span><UserPlus size={17}/></span><div><h3>Convidar Co-Produtor</h3><p>Defina o parceiro, a participação e onde ela será aplicada.</p></div></div><button type="button" className={styles.secondary} disabled={busy} onClick={()=>ref.current?.close()}>Fechar</button></header>
    <div className={styles.inviteModalBody}>
      <form className={styles.formGrid} onSubmit={event=>void onInvite(event)}>
        <label className={styles.field}>E-mail<input name="email" type="email" placeholder="parceiro@exemplo.com" required autoFocus/></label>
        <label className={styles.field}>Participação (%)<input name="share" type="number" min="0.01" max="100" step="0.01" placeholder="10" required/></label>
        <label className={styles.field}>Aplicação<select name="offerId"><option value="">Produto inteiro</option>{offers.map(offer=><option key={offer.id} value={offer.id}>{offer.name}</option>)}</select></label>
        <button className={styles.primary} disabled={busy}>{busy?"Criando...":"Criar convite"}</button>
      </form>
      {error&&<p className={styles.error} role="alert">{error}</p>}
      {message&&<p className={styles.success} role="status">{message}</p>}
      {link&&<div className={styles.linkBox}><Link2 size={15}/><code>{link}</code><button type="button" className={styles.secondary} onClick={()=>void onCopy()}>{copied?<Check size={14}/>:<Copy size={14}/>}Copiar</button></div>}
    </div>
  </dialog>;
}
