"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Check, Copy, Link2, MailPlus, ShieldCheck, UserPlus, UsersRound } from "lucide-react";
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

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`${styles.switch} ${checked ? styles.switchOn : ""}`} onClick={() => onChange(!checked)}><span/></button>;
}

function StatusBadge({ status }: { status: string }) {
  const active = status === "active";
  const pending = status === "pending";
  const label: Record<string, string> = { active: "Ativo", pending: "Pendente", rejected: "Recusado", blocked: "Bloqueado", cancelled: "Cancelado" };
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
      const result = await requestJson<{ program: AffiliateProgram }>(`/api/products/${id}/affiliate-program`, {
        method: "PUT",
        body: JSON.stringify({ mode, active, cookieDays: 30 }),
      });
      setProgram(result.program);
      setMode(result.program.mode);
      setActive(result.program.active);
      setMessage(result.program.mode === "invite"
        ? "Modo Somente convite salvo. Você já pode convidar afiliados."
        : "Programa de afiliados atualizado.");
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
      const result = await requestJson<{ invitationPath: string }>(`/api/products/${id}/affiliates/invite`, {
        method: "POST",
        body: JSON.stringify({ email }),
      });
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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao atualizar afiliado.");
    } finally { setBusy(false); }
  }

  async function copyInvite(member: AffiliateMember) {
    const url = `${location.origin}/convites/afiliacao?code=${encodeURIComponent(member.code)}`;
    await copy(url);
    setCopied(member.id);
    setTimeout(() => setCopied(""), 1200);
  }

  const persistedInvite = program?.active === true && program.mode === "invite";
  const activeCount = members.filter(item => item.status === "active").length;
  const pendingCount = members.filter(item => item.status === "pending").length;
  const configChanged = program?.mode !== mode || program?.active !== active;

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
      <div className={styles.configFooter}><span className={styles.meta}>{configChanged ? "Há alterações não salvas." : "Atribuição padrão: 30 dias após o clique."}</span><button type="button" className={styles.primary} disabled={busy} onClick={() => void saveProgram()}>{busy ? "Salvando..." : "Salvar configuração"}</button></div>
    </section>

    {mode === "invite" && <section className={styles.card}>
      <div className={styles.cardHeader}><div><span><MailPlus size={16}/></span><div><h3>Convidar afiliado</h3><p>Informe o e-mail da conta Prosperity Pay que receberá o convite.</p></div></div></div>
      <form className={styles.inviteGrid} onSubmit={invite}>
        <label className={styles.field}>E-mail do afiliado<input name="email" type="email" placeholder="afiliado@exemplo.com" required/></label>
        <button className={styles.primary} disabled={busy || !persistedInvite}><UserPlus size={15}/>{busy ? "Criando..." : "Criar convite"}</button>
      </form>
      {!active && <p className={styles.notice}>Ative o programa e salve a configuração para enviar convites.</p>}
      {active && !persistedInvite && <p className={styles.notice}>Clique em <strong>Salvar configuração</strong> para confirmar o modo Somente convite antes de enviar.</p>}
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
