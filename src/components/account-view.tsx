"use client";
import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/ui/page-header";
import { requestJson } from "@/lib/operational";
type Identity = { legal_name: string; person_type: string; status: string; review_note: string | null };
type Pix = {id:string;key_type:string;key_last4:string;status:string;is_primary:boolean};
export function AccountView() {
 const [identity,setIdentity]=useState<Identity|null>(null),[pix,setPix]=useState<Pix[]>([]),[email,setEmail]=useState(""),[error,setError]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
 const load=useCallback(async()=>{try{const [i,p]=await Promise.all([requestJson<{verification:Identity|null}>("/api/financial-profile/identity"),requestJson<{payoutAccounts:Pix[]}>("/api/financial-profile/pix")]);setIdentity(i.verification);setPix(p.payoutAccounts);setError("");}catch(cause){setError(String(cause));}},[]);
 useEffect(()=>{void Promise.resolve().then(load);void createClient().auth.getUser().then(({data})=>setEmail(data.user?.email??""));},[load]);
 async function submit(path:string,data:object){setBusy(true);setError("");setMessage("");try{await requestJson(path,{method:"POST",body:JSON.stringify(data)});await load();setMessage("Dados enviados para análise.");}catch(cause){setError(cause instanceof Error?cause.message:"Falha ao salvar.");}finally{setBusy(false);}}
 async function sendIdentity(e:FormEvent<HTMLFormElement>){e.preventDefault();const d=new FormData(e.currentTarget);await submit("/api/financial-profile/identity",{personType:d.get("personType"),legalName:d.get("legalName"),taxId:d.get("taxId"),birthDate:d.get("birthDate")||undefined,businessName:d.get("businessName")||undefined});}
 async function sendPix(e:FormEvent<HTMLFormElement>){e.preventDefault();const d=new FormData(e.currentTarget);await submit("/api/financial-profile/pix",{keyType:d.get("keyType"),pixKey:d.get("pixKey"),holderName:d.get("holderName"),holderTaxId:d.get("holderTaxId"),isPrimary:pix.length===0});}
 return <><PageHeader title="Minha conta" description={email}/>{error&&<p className="form-error" role="alert">{error}</p>}{message&&<p className="form-success" role="status">{message}</p>}
 <section className="panel operational-panel"><h2>Verificação de identidade</h2><p>{identity ? `${identity.legal_name} · ${identity.status}` : "Ainda não enviada"}</p>{identity?.review_note&&<p>Observação: {identity.review_note}</p>}
 {(!identity||["rejected","resubmission_required"].includes(identity.status))&&<form className="operational-form form-grid" onSubmit={sendIdentity}><label>Tipo de pessoa<select name="personType"><option value="individual">Pessoa física</option><option value="business">Pessoa jurídica</option></select></label><label>Nome legal<input name="legalName" required/></label><label>CPF ou CNPJ<input name="taxId" required/></label><label>Data de nascimento (pessoa física)<input name="birthDate" type="date"/></label><label>Razão social (pessoa jurídica)<input name="businessName"/></label><button className="primary-button" disabled={busy}>Enviar para análise</button></form>}</section>
 <section className="panel operational-panel"><h2>Chaves Pix</h2>{pix.length?pix.map(item=><div className="record-row" key={item.id}>{item.key_type} · ••••{item.key_last4} · {item.status}</div>):<p>Nenhuma chave cadastrada.</p>}
 <form className="operational-form form-grid" onSubmit={sendPix}><label>Tipo de chave<select name="keyType"><option value="cpf">CPF</option><option value="cnpj">CNPJ</option><option value="email">E-mail</option><option value="phone">Telefone</option><option value="random_key">Aleatória</option></select></label><label>Chave Pix<input name="pixKey" required/></label><label>Nome do titular<input name="holderName" required/></label><label>CPF/CNPJ do titular<input name="holderTaxId" required/></label><button className="primary-button" disabled={busy}>Cadastrar chave</button></form></section>
 <section className="panel operational-panel"><h2>Mercado Pago</h2><Link href="/integracoes">Ver integração →</Link></section><section className="panel operational-panel"><h2>Segurança</h2><Link href="/esqueci-senha">Alterar senha pelo e-mail →</Link></section></>;
}
