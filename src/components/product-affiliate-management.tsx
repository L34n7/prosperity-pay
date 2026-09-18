"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Check, Copy, Link2, MailPlus, Settings2, ShieldCheck, UserPlus, UsersRound } from "lucide-react";
import { ProductAffiliateSettingsDialog, type AffiliateOfferSettings, type AffiliateProductSettings, type AffiliateProgramSettings } from "@/components/product-affiliate-settings-dialog";
import { requestJson } from "@/lib/operational";
import styles from "./product-partner-management.module.css";

type AffiliateMember = { id:string; code:string; status:string; created_at?:string; profiles:{full_name:string;email:string}|null };

function StatusBadge({status}:{status:string}) {
  const label:Record<string,string>={active:"Ativo",pending:"Pendente",rejected:"Recusado",blocked:"Bloqueado",cancelled:"Cancelado"};
  return <span className={`${styles.badge} ${status==="active"?styles.badgeActive:status==="pending"?styles.badgePending:""}`}>{label[status]??status}</span>;
}
async function copy(text:string){await navigator.clipboard.writeText(text);}

export function ProductAffiliateManagement({id}:{id:string}) {
  const [program,setProgram]=useState<AffiliateProgramSettings|null>(null);
  const [offers,setOffers]=useState<AffiliateOfferSettings[]>([]);
  const [product,setProduct]=useState<AffiliateProductSettings|null>(null);
  const [members,setMembers]=useState<AffiliateMember[]>([]);
  const [settingsOpen,setSettingsOpen]=useState(false);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [busy,setBusy]=useState(false);
  const [inviteUrl,setInviteUrl]=useState("");
  const [copied,setCopied]=useState("");

  const load=useCallback(async()=>{
    try{
      const data=await requestJson<{program:AffiliateProgramSettings|null;memberships:AffiliateMember[];offers:AffiliateOfferSettings[];product:AffiliateProductSettings}>(`/api/products/${id}/affiliates`);
      setProgram(data.program); setMembers(data.memberships??[]); setOffers(data.offers??[]); setProduct(data.product??null); setError("");
    }catch(cause){setError(cause instanceof Error?cause.message:"Falha ao carregar afiliados.");}
  },[id]);
  useEffect(()=>{void load();},[load]);

  async function invite(event:FormEvent<HTMLFormElement>){
    event.preventDefault(); const form=event.currentTarget; const email=new FormData(form).get("email");
    setBusy(true);setError("");setMessage("");
    try{
      const result=await requestJson<{invitationPath:string}>(`/api/products/${id}/affiliates/invite`,{method:"POST",body:JSON.stringify({email})});
      setInviteUrl(`${location.origin}${result.invitationPath}`); setMessage("Convite criado. Envie o link ao afiliado."); form.reset(); await load();
    }catch(cause){setError(cause instanceof Error?cause.message:"Falha ao criar convite.");}finally{setBusy(false);}
  }

  async function setMemberStatus(memberId:string,status:"active"|"blocked"){
    setBusy(true);setError("");
    try{await requestJson(`/api/products/${id}/affiliates/${memberId}`,{method:"PATCH",body:JSON.stringify({status})});await load();}
    catch(cause){setError(cause instanceof Error?cause.message:"Falha ao atualizar afiliado.");}finally{setBusy(false);}
  }

  async function copyInvite(member:AffiliateMember){
    const url=`${location.origin}/convites/afiliacao?code=${encodeURIComponent(member.code)}`;
    await copy(url);setCopied(member.id);setTimeout(()=>setCopied(""),1200);
  }

  const activeCount=members.filter(item=>item.status==="active").length;
  const pendingCount=members.filter(item=>item.status==="pending").length;
  const persistedInvite=program?.active===true&&program.mode==="invite";

  return <div className={styles.shell}>
    <section className={styles.hero}>
      <div className={styles.heroTitle}><div className={styles.heroIcon}><UsersRound size={19}/></div><div><small>Parcerias</small><h2>Programa de afiliados</h2><p>Configure as regras comerciais antes de liberar afiliados para este produto.</p></div></div>
      <div className={styles.heroActions}>
        <div className={styles.statusBox}><span><strong>{program?.active?"Programa ativo":"Programa pausado"}</strong><small>{activeCount} ativos · {pendingCount} pendentes</small></span><i className={`${styles.statusDot} ${program?.active?styles.statusDotOn:""}`}/></div>
        <button type="button" className={styles.primary} onClick={()=>setSettingsOpen(true)}><Settings2 size={15}/>{program?"Configurar afiliação":"Configurar e habilitar"}</button>
      </div>
    </section>

    {error&&<p className={styles.error} role="alert">{error}</p>}
    {message&&<p className={styles.success} role="status">{message}</p>}

    {program?.mode==="invite"&&<section className={styles.card}>
      <div className={styles.cardHeader}><div><span><MailPlus size={16}/></span><div><h3>Convidar afiliado</h3><p>Informe o e-mail da conta Prosperity Pay que receberá o convite.</p></div></div></div>
      <form className={styles.inviteGrid} onSubmit={invite}>
        <label className={styles.field}>E-mail do afiliado<input name="email" type="email" placeholder="afiliado@exemplo.com" required/></label>
        <button className={styles.primary} disabled={busy||!persistedInvite}><UserPlus size={15}/>{busy?"Criando...":"Criar convite"}</button>
      </form>
      {!program.active&&<p className={styles.notice}>Ative o programa nas configurações para enviar convites.</p>}
      {inviteUrl&&<div className={styles.linkBox}><Link2 size={15}/><code>{inviteUrl}</code><button type="button" className={styles.secondary} onClick={()=>void copy(inviteUrl)}><Copy size={14}/>Copiar</button></div>}
    </section>}

    <section className={styles.card}>
      <div className={styles.cardHeader}><div><span><ShieldCheck size={16}/></span><div><h3>Afiliados do produto</h3><p>Acompanhe solicitações, aprovações e bloqueios.</p></div></div></div>
      {members.length?<div className={styles.list}>{members.map(member=><div className={styles.row} key={member.id}>
        <div className={styles.identity}><strong>{member.profiles?.full_name||"Afiliado"}</strong><small>{member.profiles?.email||"Conta vinculada"}</small></div>
        <code className={styles.code}>{member.code}</code><StatusBadge status={member.status}/>
        <div className={styles.rowActions}>
          {member.status==="pending"&&program?.mode==="approval"&&<button type="button" className={styles.secondary} disabled={busy} onClick={()=>void setMemberStatus(member.id,"active")}><Check size={14}/>Aprovar</button>}
          {member.status==="pending"&&program?.mode==="invite"&&<button type="button" className={styles.secondary} onClick={()=>void copyInvite(member)}>{copied===member.id?<Check size={14}/>:<Copy size={14}/>}Convite</button>}
          {member.status==="active"&&<button type="button" className={styles.danger} disabled={busy} onClick={()=>void setMemberStatus(member.id,"blocked")}>Bloquear</button>}
        </div>
      </div>)}</div>:<div className={styles.empty}>Nenhum afiliado vinculado a este produto ainda.</div>}
    </section>

    {settingsOpen&&<ProductAffiliateSettingsDialog productId={id} program={program} offers={offers} product={product}
      onClose={()=>setSettingsOpen(false)}
      onSaved={(nextProgram,nextOffers)=>{setProgram(nextProgram);setOffers(nextOffers);setSettingsOpen(false);setMessage(nextProgram.active?"Programa de afiliados configurado e ativo.":"Configurações salvas. O programa permanece pausado.");}}/>}
  </div>;
}
