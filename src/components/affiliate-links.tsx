"use client";
type Membership={id:string;code:string;status:string;affiliate_programs:{product_id:string;products:{name:string;offers:{name:string;checkout_slug:string;status:string}[]}|null}|null};
export function AffiliateLinks({memberships}:{memberships:Membership[]}){return <div className="records-list">{memberships.map(m=><div key={m.id}><h2>{m.affiliate_programs?.products?.name} · {m.status}</h2><p>Código: {m.code}</p>{m.status==="active"&&m.affiliate_programs?.products?.offers?.filter(o=>o.status==="active").map(o=><div className="record-row" key={o.checkout_slug}><span>{o.name}</span><button className="secondary-button" onClick={()=>navigator.clipboard.writeText(`${location.origin}/checkout/${o.checkout_slug}?ref=${encodeURIComponent(m.code)}`)}>Copiar link de afiliado</button></div>)}</div>)}</div>}
import { useRouter } from "next/navigation";
import { useState } from "react";
import { requestJson } from "@/lib/operational";
export function AvailablePrograms({programs}:{programs:{id:string;mode:string;products:{id:string;name:string;producer_id:string}|null}[]}){
 const router=useRouter(),[error,setError]=useState("");
 return <>{error&&<p className="form-error" role="alert">{error}</p>}{programs.map(program=><div key={program.id} className="record-row"><strong>{program.products?.name}</strong><span>{program.mode==="public"?"Entrada imediata":"Sujeito à aprovação"}</span><button className="secondary-button" onClick={async()=>{try{await requestJson(`/api/affiliate-programs/${program.id}/join`,{method:"POST",body:"{}"});router.refresh();}catch(cause){setError(cause instanceof Error?cause.message:"Falha ao solicitar afiliação.");}}}>Participar</button></div>)}</>;
}
