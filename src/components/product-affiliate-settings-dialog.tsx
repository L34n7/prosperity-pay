"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Globe2, Link2, Settings2, ShieldCheck, Tags, X } from "lucide-react";
import { requestJson } from "@/lib/operational";
import styles from "./product-affiliate-settings-dialog.module.css";

export type AffiliateMode="public"|"approval"|"invite";
export type AttributionModel="last_click"|"first_click";
export type AffiliateProgramSettings={id:string;mode:AffiliateMode;active:boolean;cookie_days:number;terms:string|null;attribution_model:AttributionModel;customer_data_access:boolean;marketplace_enabled:boolean;commission_addons:boolean;commission_prorated_changes:boolean;support_email:string|null;landing_page_url:string|null;marketplace_description:string|null;marketplace_tags:string[]};
export type AffiliateOfferSettings={id:string;name:string;price_cents:number;status:string;affiliate_enabled:boolean;affiliate_commission_bps:number;prosperity_fee_type:"percentage"|"fixed"|"hybrid"|null;prosperity_fee_bps:number|null;prosperity_fee_fixed_cents:number|null};
export type AffiliateProductSettings={settlement_model:"connected_account"|"prosperity_balance";payment_type:"one_time"|"recurring";prosperity_fee_type:"percentage"|"fixed"|"hybrid";prosperity_fee_bps:number;prosperity_fee_fixed_cents:number};

function Switch({checked,disabled,onChange,label}:{checked:boolean;disabled?:boolean;onChange:(value:boolean)=>void;label:string}){return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={`${styles.switch} ${checked?styles.switchOn:""}`} onClick={()=>onChange(!checked)}><span/></button>}

export function ProductAffiliateSettingsDialog({productId,program,offers,product,onClose,onSaved}:{productId:string;program:AffiliateProgramSettings|null;offers:AffiliateOfferSettings[];product:AffiliateProductSettings|null;onClose:()=>void;onSaved:(program:AffiliateProgramSettings,offers:AffiliateOfferSettings[])=>void}){
  const ref=useRef<HTMLDialogElement>(null);
  const [active,setActive]=useState(program?.active??false);
  const [mode,setMode]=useState<AffiliateMode>(program?.mode??"approval");
  const [customerDataAccess,setCustomerDataAccess]=useState(program?.customer_data_access??false);
  const [marketplaceEnabled,setMarketplaceEnabled]=useState(program?.marketplace_enabled??false);
  const [commissionAddons,setCommissionAddons]=useState(program?.commission_addons??false);
  const [commissionProratedChanges,setCommissionProratedChanges]=useState(program?.commission_prorated_changes??false);
  const [attributionModel,setAttributionModel]=useState<AttributionModel>(program?.attribution_model??"last_click");
  const [cookieDays,setCookieDays]=useState(program?.cookie_days??30);

  const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  useEffect(()=>{ref.current?.showModal()},[]);
  const enabledCount=offers.filter((item)=>item.affiliate_enabled).length;
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const data=new FormData(event.currentTarget);setBusy(true);setError("");
    try{
      const result=await requestJson<{program:AffiliateProgramSettings;offers:AffiliateOfferSettings[]}>(`/api/products/${productId}/affiliate-program`,{method:"PUT",body:JSON.stringify({
        active,mode,customerDataAccess,marketplaceEnabled,commissionAddons,commissionProratedChanges,attributionModel,cookieDays,
        supportEmail:data.get("supportEmail"),landingPageUrl:data.get("landingPageUrl"),marketplaceDescription:data.get("marketplaceDescription"),
        marketplaceTags:String(data.get("marketplaceTags")??"").split(",").map(v=>v.trim()).filter(Boolean),terms:data.get("terms")
      })});
      onSaved(result.program,result.offers);ref.current?.close();
    }catch(cause){setError(cause instanceof Error?cause.message:"Falha ao salvar as configurações.");}finally{setBusy(false)}
  }
  return <dialog ref={ref} className={styles.dialog} onClose={onClose} onCancel={e=>{if(busy)e.preventDefault()}}>
    <form className={styles.form} onSubmit={submit}>
      <header className={styles.header}><div><span>Programa de afiliados</span><h2>Configurações de afiliação</h2><p>Defina as regras antes de liberar este produto para afiliados.</p></div><button type="button" className={styles.close} disabled={busy} onClick={()=>ref.current?.close()} aria-label="Fechar"><X size={19}/></button></header>
      <div className={styles.body}>
        <section className={styles.block}><div className={styles.blockTitle}><span><Settings2 size={17}/></span><div><h3>Disponibilidade e entrada</h3><p>Controle como novos afiliados entram no programa.</p></div></div>
          <div className={styles.toggleList}>
            <div className={styles.toggleRow}><div><strong>Habilitar sistema de afiliados</strong><small>Novas compras só geram comissão enquanto o programa estiver ativo.</small></div><Switch checked={active} onChange={setActive} label="Habilitar afiliados"/></div>
            <div className={styles.toggleRow}><div><strong>Liberar acesso às informações do cliente</strong><small>Permissão para futuras visões das vendas atribuídas ao afiliado.</small></div><Switch checked={customerDataAccess} onChange={setCustomerDataAccess} label="Liberar dados do cliente"/></div>
            <div className={styles.toggleRow}><div><strong>Disponibilizar no marketplace</strong><small>Exibe o programa no catálogo de oportunidades da Prosperity Pay.</small></div><Switch checked={marketplaceEnabled} onChange={setMarketplaceEnabled} label="Disponibilizar no marketplace"/></div>
          </div>
          <div className={styles.modeGrid}>
            {([["public","Entrada automática","Entra e já pode divulgar."],["approval","Sob aprovação","Cada solicitação precisa ser aprovada."],["invite","Somente convite","Apenas usuários convidados."]] as const).map(([value,title,description])=><button type="button" key={value} className={mode===value?styles.modeActive:styles.mode} onClick={()=>setMode(value)}><strong>{title}</strong><small>{description}</small></button>)}
          </div>
        </section>

        <section className={styles.block}><div className={styles.blockTitle}><span><ShieldCheck size={17}/></span><div><h3>Suporte aos afiliados</h3><p>Informações para quem promove o produto.</p></div></div>
          <div className={styles.gridTwo}><label className={styles.field}><span>E-mail para suporte</span><input name="supportEmail" type="email" maxLength={320} defaultValue={program?.support_email??""} placeholder="afiliados@empresa.com"/></label><label className={styles.field}><span>Landing page com mais informações</span><input name="landingPageUrl" type="url" maxLength={2048} defaultValue={program?.landing_page_url??""} placeholder="https://seusite.com/afiliados"/></label></div>
        </section>

        <section className={styles.block}><div className={styles.blockTitle}><span><ShieldCheck size={17}/></span><div><h3>Regras financeiras gerais</h3><p>As porcentagens padrão são configuradas em cada Oferta. Aqui ficam somente regras válidas para todo o programa.</p></div></div>
          <p className={styles.notice}>Comissão padrão por plano/oferta: configure na aba <strong>Ofertas</strong>. Adicionais comissionáveis herdam essa porcentagem, salvo quando houver uma exceção individual para o Afiliado ou Credenciado.</p>
          {product?.payment_type==="recurring"&&<div className={styles.toggleList}>
            <div className={styles.toggleRow}><div><strong>Comissionar adicionais nas renovações</strong><small>Quando ligado, adicionais entram na comissão e podem receber um percentual individual por Afiliado ou Credenciado. Quando desligado, não geram comissão.</small></div><Switch checked={commissionAddons} onChange={setCommissionAddons} label="Comissionar adicionais"/></div>
            <div className={styles.toggleRow}><div><strong>Comissionar ajustes proporcionais</strong><small>Quando desligado, upgrades e adicionais comprados no meio do ciclo não geram comissão.</small></div><Switch checked={commissionProratedChanges} onChange={setCommissionProratedChanges} label="Comissionar valores proporcionais"/></div>
          </div>}
        </section>

        <section className={styles.block}><div className={styles.blockTitle}><span><Link2 size={17}/></span><div><h3>Atribuição</h3><p>Escolha qual indicação prevalece e a duração do cookie.</p></div></div>
          <div className={styles.attributionGrid}><button type="button" className={attributionModel==="last_click"?styles.attrActive:styles.attr} onClick={()=>setAttributionModel("last_click")}><strong>Último clique</strong><small>A indicação mais recente substitui a anterior.</small></button><button type="button" className={attributionModel==="first_click"?styles.attrActive:styles.attr} onClick={()=>setAttributionModel("first_click")}><strong>Primeiro clique</strong><small>A primeira indicação permanece até expirar.</small></button><label className={styles.field}><span>Duração do cookie</span><select value={cookieDays} onChange={e=>setCookieDays(Number(e.target.value))}>{[1,7,15,30,60,90,180,365].map(day=><option key={day} value={day}>{day} {day===1?"dia":"dias"}</option>)}</select></label></div>
        </section>

        <section className={styles.block}><div className={styles.blockTitle}><span><Globe2 size={17}/></span><div><h3>Marketplace</h3><p>Conteúdo apresentado aos afiliados no catálogo.</p></div></div>
          <div className={styles.stack}><label className={styles.field}><span>Descrição para afiliados</span><textarea name="marketplaceDescription" rows={4} maxLength={4000} defaultValue={program?.marketplace_description??""} placeholder="Explique o produto, público e diferenciais."/></label><label className={styles.field}><span><Tags size={13}/> Tags</span><input name="marketplaceTags" defaultValue={(program?.marketplace_tags??[]).join(", ")} placeholder="software, whatsapp, automação"/></label><label className={styles.field}><span>Termos do programa</span><textarea name="terms" rows={5} maxLength={10000} defaultValue={program?.terms??""} placeholder="Regras, restrições e condições de divulgação."/></label></div>
        </section>
      </div>
      {error&&<p className={styles.error} role="alert">{error}</p>}
      <footer className={styles.footer}><span>{active?`${enabledCount} oferta${enabledCount===1?"":"s"} habilitada${enabledCount===1?"":"s"}`:"Programa será salvo como pausado"}</span><div><button type="button" className={styles.secondary} disabled={busy} onClick={()=>ref.current?.close()}>Cancelar</button><button className={styles.primary} disabled={busy}>{busy?"Salvando...":"Salvar configurações"}</button></div></footer>
    </form>
  </dialog>
}
