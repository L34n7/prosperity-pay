"use client";

import Link from "next/link";
import { checkoutPath } from "@/lib/domain/offer-reference";

type Membership={id:string;code:string;status:string;affiliate_programs:{product_id:string;mode:string;active:boolean;products:{name:string;affiliate_funnel_base_url:string|null;offers:{name:string;checkout_slug:string;status:string}[]}|null}|null};

const statusLabel:Record<string,string>={active:"Ativo",pending:"Pendente",rejected:"Recusado",blocked:"Bloqueado",cancelled:"Cancelado"};

export function AffiliateLinks({memberships}:{memberships:Membership[]}){
  return <div className="records-list">{memberships.map(m=>{
    const product=m.affiliate_programs?.products;
    const primaryUrl=m.status==="active"&&product?.affiliate_funnel_base_url
      ? `${product.affiliate_funnel_base_url}${encodeURIComponent(m.code)}`
      : null;
    return <div key={m.id}>
      <h2>{product?.name||"Produto"} · {statusLabel[m.status]??m.status}</h2>
      <p>Código: {m.code}</p>
      {m.status==="pending"&&m.affiliate_programs?.mode==="invite"&&m.affiliate_programs.active&&<div className="record-row" style={{borderColor:"rgba(34,230,161,.24)",background:"rgba(34,230,161,.035)",alignItems:"center"}}>
        <span style={{display:"grid",gap:3,minWidth:0,flex:1}}>
          <strong>Você recebeu um convite para este programa</strong>
          <small style={{color:"var(--text-subtle)"}}>Aceite o convite para ativar sua afiliação e liberar seus links de venda.</small>
        </span>
        <Link className="primary-button" href={`/convites/afiliacao?code=${encodeURIComponent(m.code)}`}>Aceitar convite</Link>
      </div>}
      {primaryUrl&&<div className="record-row" style={{borderColor:"rgba(34,230,161,.24)",background:"rgba(34,230,161,.035)",alignItems:"center"}}>
        <span style={{display:"grid",gap:3,minWidth:0,flex:1}}>
          <strong>Link principal de divulgação</strong>
          <small style={{color:"var(--text-subtle)"}}>Recomendado para iniciar o funil de vendas.</small>
          <code style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{primaryUrl}</code>
        </span>
        <button className="primary-button" onClick={()=>navigator.clipboard.writeText(primaryUrl)}>Copiar link principal</button>
      </div>}
      {m.status==="active"&&product?.offers?.filter(o=>o.status==="active").map(o=><div className="record-row" key={o.checkout_slug}>
        <span style={{display:"grid",gap:2}}><strong>{o.name}</strong><small>Checkout direto</small></span>
        <button className="secondary-button" onClick={()=>navigator.clipboard.writeText(`${location.origin}${checkoutPath(o.checkout_slug)}?ref=${encodeURIComponent(m.code)}`)}>Copiar checkout</button>
      </div>)}
    </div>
  })}</div>;
}

export function AvailablePrograms({programs}:{programs:{id:string;mode:string;marketplace_description:string|null;marketplace_tags:string[];landing_page_url:string|null;products:{id:string;name:string;producer_id:string}|null}[]}){
  return <>{programs.map(program=><div key={program.id} className="record-row" style={{alignItems:"flex-start"}}>
    <div style={{display:"grid",gap:4,flex:1,minWidth:0}}>
      <strong>{program.products?.name}</strong>
      <span>{program.mode==="public"?"Entrada imediata":"Sujeito à aprovação"}</span>
      {program.marketplace_description&&<small style={{color:"var(--text-muted)",lineHeight:1.45}}>{program.marketplace_description}</small>}
      {program.marketplace_tags?.length>0&&<small style={{color:"var(--text-subtle)"}}>{program.marketplace_tags.map(tag=>`#${tag}`).join(" · ")}</small>}
      {program.landing_page_url&&<a href={program.landing_page_url} target="_blank" rel="noreferrer">Mais informações</a>}
    </div>
    <Link className="secondary-button" href={`/afiliados/participar/${program.id}`}>Participar</Link>
  </div>)}</>;
}
