"use client";

import { useMemo, useState } from "react";
import {
  AlertCircle, ArrowDownCircle, ArrowUpCircle, Banknote, CalendarDays,
  Check, CheckCircle2, ChevronDown, ChevronRight, Clock3, CreditCard,
  Landmark, Pencil, Plus, ReceiptText, Settings2, ShieldAlert,
  Trash2, TrendingDown, Wallet, X,
} from "lucide-react";
import { formatCents } from "@/lib/operational";
import { brazilDate, dayPlus, invoiceDueDate, projectCashFlow } from "@/lib/accounting/cash-flow";
import type { Card, CardPayment, CardAdjustment, ExpectedIncome, CardInvoice, ForecastEvent } from "@/lib/accounting/cash-flow";
import type { Bank, CashBox } from "@/lib/accounting/calculations";
import styles from "./cash-flow-panel.module.css";

export type PlannerView = {
  month:string; banks:Bank[]; boxes:CashBox[];
  cards:Card[]; cardPayments:CardPayment[]; cardAdjustments:CardAdjustment[];
  expectedIncomes:ExpectedIncome[]; invoices:CardInvoice[];
  forecast:{today:string;balances:Record<string,number>;events:ForecastEvent[]};
};
type CashForm = {
  id?:string; title:string; amount:string; expectedOn:string; bankId:string; boxId:string; notes:string;
};
type CardForm = {
  id?:string;name:string;dueDay:number;closingDay:string;defaultBankId:string;
  sourceBankId:string;active:boolean;
};
type PayForm = {
  invoice:CardInvoice; bankId:string; amount:string; paidAt:string;
  token:string;notes:string;allowNegative:boolean;
};
type AdjustmentForm = {
  invoice:CardInvoice;kind:"credit"|"debit";title:string;amount:string;notes:string;
};
const money=(cents:number)=>formatCents(cents);
const validCents=(text:string)=>{
  const amount=Math.round(Number(text.trim().replace(",","."))*100);
  return Number.isSafeInteger(amount)&&amount>0 ? amount : 0;
};
const shortDate=(day:string)=>new Date(day+"T12:00:00Z")
  .toLocaleDateString("pt-BR",{timeZone:"UTC",day:"2-digit",month:"short",year:"numeric"});
const asMoneyInput=(n:number)=>(n/100).toFixed(2);
function localClock(){
  const parts=new Intl.DateTimeFormat("en-US",{
    timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit",
    hour:"2-digit",minute:"2-digit",hourCycle:"h23",
  }).formatToParts(new Date());
  const get=(k:string)=>parts.find(x=>x.type===k)?.value??"";
  return get("year")+"-"+get("month")+"-"+get("day")+"T"+get("hour")+":"+get("minute");
}
export function CashFlowPanel({view,mode,onChanged,closed}:{
  view:PlannerView;mode:"forecast"|"cards";onChanged:()=>void;closed:boolean;
}) {
  const [days,setDays]=useState(30);
  const [bankFilter,setBankFilter]=useState("");
  const [boxFilter,setBoxFilter]=useState("");
  const [showAllDays,setShowAllDays]=useState(false);
  const [showReceipts,setShowReceipts]=useState(true);
  const [showCardsSettings,setShowCardsSettings]=useState(false);
  const [receipt,setReceipt]=useState<CashForm|null>(null);
  const [confirmReceipt,setConfirmReceipt]=useState<{item:ExpectedIncome;at:string}|null>(null);
  const [pay,setPay]=useState<PayForm|null>(null);
  const [card,setCard]=useState<CardForm|null>(null);
  const [adjustment,setAdjustment]=useState<AdjustmentForm|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [openInvoices,setOpenInvoices]=useState<Record<string,boolean>>({});
  const liveBanks=view.banks.filter(b=>b.active);
  const liveBoxes=view.boxes.filter(b=>b.active);
  const findBank=(id:string|null)=>view.banks.find(b=>b.id===id)?.name??"Banco não definido";
  const findBox=(id:string)=>view.boxes.find(b=>b.id===id)?.name??"Caixa não encontrado";
  const horizon=useMemo(()=>projectCashFlow({
    start:view.forecast.today,days,balances:view.forecast.balances,events:view.forecast.events,
    bankId:bankFilter||undefined,boxId:boxFilter||undefined,
  }),[view,days,bankFilter,boxFilter]);
  const boxWarnings=useMemo(()=>view.boxes.filter(b=>b.active).map(b=>{
    const plan=projectCashFlow({start:view.forecast.today,days,balances:view.forecast.balances,
      events:view.forecast.events,boxId:b.id});
    return {box:b,min:plan.minimum_cents,date:plan.first_shortfall_date};
  }).filter(item=>item.min<0),[view,days]);
  const monthInvoices=view.invoices.filter(i=>i.invoice_month===view.month+"-01");
  const overdueInvoices=view.invoices.filter(i=>i.remaining_cents>0&&i.due_on<view.forecast.today&&i.invoice_month!==view.month+"-01");
  const shownInvoices=[...monthInvoices,...overdueInvoices].sort((a,b)=>a.due_on.localeCompare(b.due_on));
  const unpaidInMonth=monthInvoices.reduce((s,i)=>s+i.remaining_cents,0);
  const cardMonthlyTotals=view.cards
    .map(card=>{
      const invoices=monthInvoices.filter(i=>i.card_id===card.id);
      return {id:card.id,name:card.name,
        total:invoices.reduce((s,i)=>s+i.total_cents+i.adjustment_cents,0),
        remaining:invoices.reduce((s,i)=>s+i.remaining_cents,0),
        count:invoices.reduce((s,i)=>s+i.charges,0),
        active:card.active,
      };
    }).filter(card=>card.active||card.count>0)
    .sort((a,b)=>b.total-a.total||a.name.localeCompare(b.name,"pt-BR"));
  const extraUnassigned=monthInvoices.filter(i=>i.remaining_cents>0&&!i.default_payment_bank_id)
    .reduce((s,i)=>s+i.remaining_cents,0);
  const nextReceipts=view.expectedIncomes.filter(r=>r.status==="expected")
    .sort((a,b)=>a.expected_on.localeCompare(b.expected_on));
  const selectedReceipts=view.expectedIncomes.filter(r=>r.expected_on.slice(0,7)===view.month)
    .sort((a,b)=>a.expected_on.localeCompare(b.expected_on));
  const relevantDays=horizon.days.filter(d=>showAllDays||d.items.length||d.balance_cents<0);
  async function send(method:"POST"|"PATCH"|"DELETE",body:Record<string,unknown>,message:string){
    if(busy)return false;
    setBusy(true);setError("");setNotice("");
    try{
      const res=await fetch("/api/contabilidade/planejamento",{
        method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body),
      });
      const result=await res.json();
      if(!res.ok)throw new Error(result.error||"Não foi possível concluir.");
      setNotice(message);onChanged();return true;
    }catch(e){setError(e instanceof Error?e.message:"Não foi possível salvar.");return false;}
    finally{setBusy(false);}
  }
  function newReceipt(item?:ExpectedIncome){
    setError("");setReceipt({
      id:item?.id,title:item?.title??"",amount:item?asMoneyInput(item.amount_cents):"",
      expectedOn:item?.expected_on??view.forecast.today,
      bankId:item?.bank_id??liveBanks[0]?.id??"",boxId:item?.box_id??liveBoxes[0]?.id??"",
      notes:item?.notes??"",
    });
  }
  async function saveReceipt(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();if(!receipt)return;
    const value=validCents(receipt.amount);
    if(!value){setError("Informe um valor positivo.");return;}
    const saved=await send(receipt.id?"PATCH":"POST",{
      action:"expected_income",id:receipt.id,title:receipt.title,amountCents:value,
      expectedOn:receipt.expectedOn,bankId:receipt.bankId,boxId:receipt.boxId,notes:receipt.notes,
    },receipt.id?"Previsão atualizada.":"Recebimento previsto cadastrado. Ainda não altera o saldo.");
    if(saved)setReceipt(null);
  }
  async function receive(){
    if(!confirmReceipt)return;
    const saved=await send("PATCH",{action:"expected_income",id:confirmReceipt.item.id,
      status:"received",receivedAt:confirmReceipt.at},"Recebimento confirmado: agora integra o saldo contabilizado.");
    if(saved)setConfirmReceipt(null);
  }
  async function cancelReceipt(item:ExpectedIncome){
    if(!confirm("Cancelar a previsão de "+item.title+"? Ela deixará de entrar no fluxo previsto."))return;
    await send("PATCH",{action:"expected_income",id:item.id,status:"cancelled"},"Previsão cancelada.");
  }
  async function deleteReceipt(item:ExpectedIncome){
    if(!confirm("Excluir "+item.title+"?"+(item.status==="received"?" Isso também reverterá o saldo confirmado.":"")))return;
    await send("DELETE",{action:"expected_income",id:item.id},"Registro excluído.");
  }
  function startPay(invoice:CardInvoice){
    const preferred=liveBanks.find(b=>b.id===invoice.default_payment_bank_id)?.id??liveBanks[0]?.id??"";
    setError("");
    setPay({invoice,bankId:preferred,amount:asMoneyInput(invoice.remaining_cents),
      paidAt:localClock(),token:crypto.randomUUID(),notes:"",allowNegative:false});
  }
  async function savePay(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();if(!pay)return;
    const value=validCents(pay.amount);
    if(!value||value>pay.invoice.remaining_cents){setError("Valor inválido ou acima do saldo da fatura.");return;}
    const key=pay.bankId+":"+pay.invoice.box_id;
    const current=view.forecast.balances[key]??0;
    if(value>current&&!pay.allowNegative){
      setError("O valor supera o saldo disponível neste banco e caixa. Revise ou confirme a divergência.");return;
    }
    const saved=await send("POST",{
      action:"card_payment",cardId:pay.invoice.card_id,boxId:pay.invoice.box_id,
      bankId:pay.bankId,invoiceMonth:pay.invoice.invoice_month,amountCents:value,
      paidAt:pay.paidAt,clientToken:pay.token,notes:pay.notes,
    },"Pagamento de fatura registrado. O saldo bancário foi reduzido uma única vez.");
    if(saved)setPay(null);
  }
  function editCard(item?:Card){
    setError("");
    setCard({
      id:item?.id,name:item?.name??"",dueDay:item?.due_day??10,
      closingDay:item?.closing_day?String(item.closing_day):"",
      defaultBankId:item?.default_payment_bank_id??"",
      sourceBankId:item?.legacy_bank_id??liveBanks[0]?.id??"",
      active:item?.active??true,
    });
  }
  async function saveCard(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();if(!card)return;
    const saved=await send(card.id?"PATCH":"POST",{
      action:"card",id:card.id,name:card.name,dueDay:card.dueDay,
      closingDay:card.closingDay?Number(card.closingDay):null,
      defaultBankId:card.defaultBankId||null,sourceBankId:card.sourceBankId,active:card.active,
    },"Configuração do cartão atualizada.");
    if(saved)setCard(null);
  }
  async function saveAdjustment(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();if(!adjustment)return;
    const amount=validCents(adjustment.amount);
    if(!amount){setError("Informe um valor válido.");return;}
    const saved=await send("POST",{
      action:"card_adjustment",cardId:adjustment.invoice.card_id,
      boxId:adjustment.invoice.box_id,invoiceMonth:adjustment.invoice.invoice_month,
      kind:adjustment.kind,title:adjustment.title,amountCents:amount,notes:adjustment.notes,
    },"Ajuste incorporado à fatura sem movimentar saldo bancário.");
    if(saved)setAdjustment(null);
  }
  async function deleteAdjustment(item:CardAdjustment){
    if(!confirm("Excluir ajuste de "+money(item.amount_cents)+" da fatura?"))return;
    await send("DELETE",{action:"card_adjustment",id:item.id},"Ajuste excluído.");
  }
  async function deletePay(item:CardPayment){
    if(!confirm("Estornar registro de pagamento de "+money(item.amount_cents)+"? O valor voltará ao saldo do banco/caixa e a fatura ficará em aberto novamente."))return;
    await send("DELETE",{action:"card_payment",id:item.id},"Pagamento estornado. Confira o extrato real.");
  }
  const boxLimit=boxFilter?view.boxes.filter(b=>b.id===boxFilter):liveBoxes;
  const filteredSummary=<div className={styles.insightSummary}>
    <span>Saldo contabilizado</span><strong>{money(horizon.starting_cents)}</strong>
    <span>+ Previstos</span><strong className={styles.green}>{money(horizon.expected_in_cents)}</strong>
    <span>− A vencer</span><strong className={styles.orange}>{money(horizon.scheduled_out_cents)}</strong>
    <span>Saldo projetado</span><strong className={horizon.final_cents<0?styles.red:styles.green}>{money(horizon.final_cents)}</strong>
  </div>;
  return <section className={styles.root}>
    {notice&&<div className={styles.notice} role="status"><CheckCircle2 size={17}/>{notice}
      <button aria-label="Fechar aviso" onClick={()=>setNotice("")}><X size={16}/></button></div>}
    {error&&<div className={styles.error} role="alert"><AlertCircle size={18}/>{error}
      <button aria-label="Fechar erro" onClick={()=>setError("")}><X size={16}/></button></div>}
    {mode==="forecast"&&<>
      <div className={styles.topPanel}>
        <div><span className={styles.eyebrow}>Planejamento de caixa</span><h2>Quando vai faltar dinheiro?</h2>
          <p>Previsão diária a partir do saldo real. Recebimentos ainda esperados aparecem apenas na projeção, nunca como dinheiro disponível.</p>
        </div>
        <button className={styles.primary} onClick={()=>newReceipt()}><Plus size={17}/> Prever recebimento</button>
      </div>
      <div className={styles.filters}>
        <label>Horizonte<select value={days} onChange={e=>setDays(Number(e.target.value))}>
          {[15,30,60,90,120].map(d=><option key={d} value={d}>{d} dias</option>)}
        </select></label>
        <label>Banco<select value={bankFilter} onChange={e=>setBankFilter(e.target.value)}>
          <option value="">Todos os bancos</option>{liveBanks.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
        </select></label>
        <label>Caixa<select value={boxFilter} onChange={e=>setBoxFilter(e.target.value)}>
          <option value="">Todos os caixas</option>{view.boxes.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
        </select></label>
      </div>
      <div className={styles.kpis}>
        <article><span>Saldo contabilizado</span><strong>{money(horizon.starting_cents)}</strong><small>Registros manuais por banco e caixa</small></article>
        <article><span>Recebimentos esperados</span><strong className={styles.green}>{money(horizon.expected_in_cents)}</strong><small>Entradas ainda não realizadas</small></article>
        <article><span>Contas a pagar</span><strong className={styles.orange}>{money(horizon.scheduled_out_cents)}</strong><small>Faturas + despesas bancárias</small></article>
        <article><span>Saldo no fim do horizonte</span><strong className={horizon.final_cents<0?styles.red:styles.green}>{money(horizon.final_cents)}</strong><small>{shortDate(dayPlus(view.forecast.today,days-1))}</small></article>
      </div>
      {horizon.first_shortfall_date&&<div className={styles.warning}>
        <ShieldAlert size={22}/><div><strong>Saldo insuficiente em {shortDate(horizon.first_shortfall_date)}</strong>
          <p>Se as contas previstas forem pagas e os recebimentos ocorrerem nas datas cadastradas, o saldo pode ficar negativo.
            Menor valor projetado: <b>{money(horizon.minimum_cents)}</b>.</p></div>
      </div>}
      {horizon.unassigned_cents>0&&<div className={styles.warning}>
        <AlertCircle size={20}/><div><strong>Faturas sem banco pagador: {money(horizon.unassigned_cents)}</strong>
          <p>Os valores estão no consolidado, mas não aparecem na previsão filtrada por banco. Configure um banco pagador para Carrefour, Sicredi ou Bradesco.</p></div>
      </div>}
      {boxWarnings.length>0&&!boxFilter&&<div className={styles.warning}>
        <AlertCircle size={20}/><div><strong>Atenção à propriedade dos caixas</strong>
          <p>{boxWarnings.map(x=>x.box.name+" pode chegar a "+money(x.min)+" em "+shortDate(x.date??view.forecast.today)).join(" · ")}.
            Dinheiro de Lucas ou de outra pessoa não é caixa livre do CRM.</p></div>
      </div>}
      <div className={styles.twoCol}>
        <div className={styles.panel}>
          <div className={styles.sectionTitle}><div><span className={styles.eyebrow}>Linha do tempo</span><h3>Projeção por dia</h3>
            <p>O saldo do dia inclui entradas esperadas e contas com vencimento até aquela data.</p></div>
            <label className={styles.switch}><input type="checkbox" checked={showAllDays}
              onChange={e=>setShowAllDays(e.target.checked)}/> Todos os dias</label></div>
          {filteredSummary}
          <div className={styles.timeline}>
            {relevantDays.length?relevantDays.map(day=><div key={day.date} className={day.balance_cents<0?styles.badDay:styles.dayRow}>
              <div className={styles.dayLabel}><strong>{shortDate(day.date)}</strong>
                <span>{day.items.length?day.items.length+" evento(s)":"Saldo previsto"}</span></div>
              <div className={styles.dayEvents}>
                {day.items.map(e=><span key={e.key} title={e.title}
                  className={e.amount_cents<0?styles.outEvent:styles.inEvent}>
                  {e.amount_cents<0?"−":"+"}{money(Math.abs(e.amount_cents))}
                  <small>{e.title}{e.overdue?" · vencido":""}</small></span>)}
                {!day.items.length&&<small>Sem movimentações previstas</small>}
              </div>
              <strong className={day.balance_cents<0?styles.red:styles.dayBalance}>{money(day.balance_cents)}</strong>
            </div>):<p className={styles.empty}>Nenhuma entrada ou conta prevista neste período.</p>}
          </div>
          {!showAllDays&&<p className={styles.footnote}>Mostrando dias com movimentações ou saldo negativo. Ative “Todos os dias” para ver o calendário inteiro.</p>}
        </div>
        <div className={styles.side}>
          <div className={styles.panel}>
            <div className={styles.sectionTitle}><div><span className={styles.eyebrow}>Controle por responsável</span>
              <h3>Caixas separados</h3></div></div>
            {boxLimit.map(b=>{
              const p=projectCashFlow({start:view.forecast.today,days,
                balances:view.forecast.balances,events:view.forecast.events,
                bankId:bankFilter||undefined,boxId:b.id});
              return <div className={styles.boxLine} key={b.id}><span><strong>{b.name}</strong>
                  <small>Hoje {money(p.starting_cents)}</small></span>
                <div><strong className={p.final_cents<0?styles.red:""}>{money(p.final_cents)}</strong>
                  <small>{p.first_shortfall_date?"Falta em "+shortDate(p.first_shortfall_date):"Previsão final"}</small></div></div>;
            })}
          </div>
          <div className={styles.panel}>
            <div className={styles.sectionTitle}><div><span className={styles.eyebrow}>Entradas futuras</span><h3>Recebimentos previstos</h3></div>
              <button className={styles.iconButton} title="Novo recebimento previsto" onClick={()=>newReceipt()}><Plus size={18}/></button></div>
            {nextReceipts.slice(0,18).map(item=><div key={item.id} className={styles.receiptItem}>
              <div className={styles.receiptTop}><div><strong>{item.title}</strong>
                <small>{shortDate(item.expected_on)} · {findBank(item.bank_id)} · {findBox(item.box_id)}</small></div>
                <b>{money(item.amount_cents)}</b></div>
              <div className={styles.miniActions}>
                <button onClick={()=>setConfirmReceipt({item,at:localClock()})}><Check size={14}/> Confirmar entrada</button>
                <button title="Editar" onClick={()=>newReceipt(item)}><Pencil size={14}/></button>
                <button title="Cancelar" onClick={()=>void cancelReceipt(item)}><X size={14}/></button>
              </div>
            </div>)}
            {!nextReceipts.length&&<p className={styles.empty}>Nenhum recebimento previsto. Cadastre as vendas e transferências que ainda podem entrar para enxergar o futuro com mais precisão.</p>}
          </div>
        </div>
      </div>
    </>}
    {mode==="cards"&&<>
      <div className={styles.topPanel}><div><span className={styles.eyebrow}>Faturas de cartão</span>
        <h2>Compras são dívidas. Pagamento é saída do banco.</h2>
        <p>Somente o pagamento confirmado debita Inter ou Mercado Pago. As compras não reduzem o saldo até a fatura ser quitada.</p></div>
        <button className={styles.secondary} onClick={()=>setShowCardsSettings(!showCardsSettings)}>
          <Settings2 size={17}/> Configurar cartões</button></div>
      <div className={styles.cardKpis}>
        <div><span>Faturas neste mês</span><strong>{new Set(monthInvoices.map(i=>i.card_id)).size}</strong></div>
        <div><span>Valor restante no mês</span><strong>{money(unpaidInMonth)}</strong></div>
        <div><span>Sem banco pagador</span><strong>{money(extraUnassigned)}</strong></div>
        {cardMonthlyTotals.map(card=><div key={card.id} className={styles.cardMonthlyTotal}>
          <span><CreditCard size={15}/> {card.name}</span>
          <strong>{money(card.total)}</strong>
          <small>{card.count} {card.count===1?"compra":"compras"} · Restante: {money(card.remaining)}</small>
        </div>)}
      </div>
      {showCardsSettings&&<div className={styles.panel}>
        <div className={styles.sectionTitle}><div><span className={styles.eyebrow}>Configurações</span><h3>Cartões e dias de vencimento</h3>
          <p>O banco pagador é apenas uma previsão. O pagamento real pode vir de outro banco, conforme a movimentação.</p></div>
          <button className={styles.secondary} onClick={()=>editCard()}><Plus size={15}/> Novo cartão</button></div>
        <div className={styles.settingsCards}>{view.cards.map(c=><button type="button" key={c.id}
          onClick={()=>editCard(c)}><CreditCard size={18}/><span><strong>{c.name}</strong><small>Vence dia {c.due_day} · {c.default_payment_bank_id?findBank(c.default_payment_bank_id):"Banco pagador pendente"}</small></span><Pencil size={15}/></button>)}</div>
      </div>}
      <div className={styles.cardList}>
        {shownInvoices.map(inv=>{
          const cardData=view.cards.find(c=>c.id===inv.card_id);
          const adjustments=view.cardAdjustments.filter(a=>a.card_id===inv.card_id&&
            a.box_id===inv.box_id&&a.invoice_month===inv.invoice_month);
          const payments=view.cardPayments.filter(p=>p.card_id===inv.card_id&&
            p.box_id===inv.box_id&&p.invoice_month===inv.invoice_month);
          const expanded=!!openInvoices[inv.key];
          const net=inv.total_cents+inv.adjustment_cents;
          return <article key={inv.key} className={styles.invoiceCard}>
            <div className={styles.invoiceMain}>
              <div className={styles.cardIcon}><CreditCard size={20}/></div>
              <div className={styles.invoiceTitle}><div className={styles.invoiceName}><h3>{inv.card_name}</h3>
                <span className={inv.remaining_cents>0?styles.openBadge:styles.doneBadge}>
                  {inv.remaining_cents>0?"A pagar":"Quitada"}</span></div>
                <p>Fatura {inv.invoice_month.slice(0,7)} · Vence {shortDate(inv.due_on)} · Caixa <b>{findBox(inv.box_id)}</b>
                  {inv.due_on<view.forecast.today&&inv.remaining_cents>0?" · Vencida":""}</p>
                <small>{inv.charges} compra(s) · {money(inv.total_cents)} em compras
                  {inv.adjustment_cents!==0?" · ajustes "+money(inv.adjustment_cents):""}</small></div>
              <div className={styles.invoiceAmount}><span>Saldo da fatura</span><strong>{money(inv.remaining_cents)}</strong>
                <small>Valor líquido {money(net)}{inv.paid_cents?" · pago "+money(inv.paid_cents):""}</small></div>
            </div>
            <div className={styles.invoiceActions}>
              <span>{cardData?.default_payment_bank_id? "Pagador previsto: "+findBank(cardData.default_payment_bank_id):
                "Defina qual banco usará para pagar"}</span>
              <div>
                <button className={styles.secondary} onClick={()=>setOpenInvoices(x=>({...x,[inv.key]:!expanded}))}>
                  {expanded?<ChevronDown size={15}/>:<ChevronRight size={15}/>} Detalhes</button>
                <button className={styles.secondary} disabled={closed} onClick={()=>{setError("");setAdjustment({
                  invoice:inv,kind:"credit",title:"",amount:"",notes:"",
                });}}><Plus size={15}/> Ajuste</button>
                <button className={styles.primary} disabled={!inv.remaining_cents}
                  onClick={()=>startPay(inv)}><Banknote size={16}/> Registrar pagamento</button>
              </div>
            </div>
            {expanded&&<div className={styles.invoiceDetails}>
              <div><strong>Ajustes / estornos / encargos</strong>
                {adjustments.map(a=><div className={styles.detailRow} key={a.id}>
                  <span>{a.title}<small>{a.kind==="credit"?"Crédito / abatimento":"Débito adicional"}</small></span>
                  <b>{a.kind==="credit"?"−":"+"}{money(a.amount_cents)}</b>
                  <button disabled={closed} title="Excluir ajuste" onClick={()=>void deleteAdjustment(a)}><Trash2 size={15}/></button>
                </div>)}
                {!adjustments.length&&<p className={styles.empty}>Sem ajustes.</p>}
              </div>
              <div><strong>Pagamentos efetivos</strong>
                {payments.map(p=><div className={styles.detailRow} key={p.id}>
                  <span>{findBank(p.bank_id)} · {shortDate(brazilDate(p.paid_at))}
                    <small>{findBox(p.box_id)}</small></span><b>{money(p.amount_cents)}</b>
                  <button title="Estornar pagamento" onClick={()=>void deletePay(p)}><Trash2 size={15}/></button>
                </div>)}
                {!payments.length&&<p className={styles.empty}>Nenhum pagamento confirmado.</p>}
              </div>
            </div>}
          </article>;
        })}
        {!shownInvoices.length&&<div className={styles.panel}><p className={styles.empty}>Não há faturas neste mês. Alterne a competência mensal ou cadastre compras na planilha.</p></div>}
      </div>
      <div className={styles.helpNote}><ShieldAlert size={18}/><div>
        <strong>Antes de pagar, confira o caixa responsável.</strong>
        <p>As compras importadas foram colocadas provisoriamente em Leandro. Edite as linhas da planilha e ajuste para CRM ou Lucas, conforme quem realmente deve pagar. Um pagamento de fatura pertence ao caixa selecionado; não é apropriado usar dinheiro de outro responsável sem registrar a transferência.</p>
      </div></div>
      {selectedReceipts.length>0&&<div className={styles.panel}>
        <h3>Entradas previstas de {view.month}</h3><p className={styles.footnote}>Registre/edite as receitas na aba Fluxo de caixa.</p>
      </div>}
    </>}

    {receipt&&<div className={styles.overlay} onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)setReceipt(null);}}>
      <section className={styles.modal} role="dialog" aria-modal="true" aria-label="Recebimento previsto">
        <div className={styles.modalTitle}><div><span className={styles.eyebrow}>Planejamento</span>
          <h3>{receipt.id?"Editar recebimento previsto":"Prever recebimento"}</h3></div>
          <button onClick={()=>setReceipt(null)} aria-label="Fechar"><X size={20}/></button></div>
        <p className={styles.footnote}>Este valor não entra no saldo até que você confirme o recebimento.</p>
        <form onSubmit={e=>void saveReceipt(e)} className={styles.formGrid}>
          <label className={styles.full}>Descrição<input autoFocus required maxLength={160} minLength={2}
            placeholder="Ex.: Renovação do plano CRM" value={receipt.title}
            onChange={e=>setReceipt({...receipt,title:e.target.value})}/></label>
          <label>Valor previsto (R$)<input required type="number" min=".01" step=".01"
            value={receipt.amount} onChange={e=>setReceipt({...receipt,amount:e.target.value})}/></label>
          <label>Data esperada<input required type="date" value={receipt.expectedOn}
            onChange={e=>setReceipt({...receipt,expectedOn:e.target.value})}/></label>
          <label>Banco que receberá<select required value={receipt.bankId}
            onChange={e=>setReceipt({...receipt,bankId:e.target.value})}>
            {liveBanks.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          <label>Caixa responsável<select required value={receipt.boxId}
            onChange={e=>setReceipt({...receipt,boxId:e.target.value})}>
            {liveBoxes.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          <label className={styles.full}>Observações (opcional)<textarea maxLength={1000} rows={2}
            value={receipt.notes} onChange={e=>setReceipt({...receipt,notes:e.target.value})}/></label>
          <div className={styles.formActions}><button type="button" className={styles.secondary}
            onClick={()=>setReceipt(null)}>Cancelar</button>
            <button className={styles.primary} disabled={busy} type="submit">{busy?"Salvando...":"Salvar previsão"}</button></div>
        </form>
      </section></div>}
    {confirmReceipt&&<div className={styles.overlay} onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)setConfirmReceipt(null);}}>
      <section className={styles.modal} role="dialog" aria-modal="true" aria-label="Confirmar recebimento">
        <div className={styles.modalTitle}><h3>Confirmar entrada no banco</h3>
          <button aria-label="Fechar" onClick={()=>setConfirmReceipt(null)}><X size={20}/></button></div>
        <p>Você realmente recebeu <b>{money(confirmReceipt.item.amount_cents)}</b> de {confirmReceipt.item.title} em {findBank(confirmReceipt.item.bank_id)} / {findBox(confirmReceipt.item.box_id)}?</p>
        <label className={styles.full}>Data e hora real do recebimento<input required type="datetime-local"
          value={confirmReceipt.at} onChange={e=>setConfirmReceipt({...confirmReceipt,at:e.target.value})}/></label>
        <p className={styles.footnote}>Depois de confirmar, o valor será somado ao saldo real. Não registre a mesma entrada outra vez em “Entradas”.</p>
        <div className={styles.formActions}><button className={styles.secondary} onClick={()=>setConfirmReceipt(null)}>Voltar</button>
          <button className={styles.primary} disabled={busy} onClick={()=>void receive()}><Check size={16}/> Confirmar recebimento</button></div>
      </section></div>}
    {pay&&<div className={styles.overlay} onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)setPay(null);}}>
      <section className={styles.modal} role="dialog" aria-modal="true" aria-label="Pagamento de fatura">
        <div className={styles.modalTitle}><div><span className={styles.eyebrow}>Saída bancária</span>
          <h3>Pagamento de {pay.invoice.card_name}</h3></div>
          <button aria-label="Fechar" onClick={()=>setPay(null)}><X size={20}/></button></div>
        <div className={styles.paymentOverview}>
          <span>Fatura de {pay.invoice.invoice_month.slice(0,7)} · Caixa {findBox(pay.invoice.box_id)}</span>
          <strong>{money(pay.invoice.remaining_cents)} em aberto</strong>
          <small>Um pagamento pode ser parcial, mas nunca ultrapassar o valor líquido da fatura.</small>
        </div>
        <form onSubmit={e=>void savePay(e)} className={styles.formGrid}>
          <label>Banco de onde saiu o dinheiro<select required value={pay.bankId}
            onChange={e=>setPay({...pay,bankId:e.target.value,allowNegative:false})}>
            {liveBanks.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          <label>Valor pago (R$)<input type="number" step=".01" min=".01" required
            value={pay.amount} onChange={e=>setPay({...pay,amount:e.target.value,allowNegative:false})}/></label>
          <label className={styles.full}>Data e hora do pagamento<input type="datetime-local" required value={pay.paidAt}
            onChange={e=>setPay({...pay,paidAt:e.target.value})}/></label>
          <div className={styles.full+" "+styles.infoPanel}>
            Saldo contabilizado do caixa <strong>{findBox(pay.invoice.box_id)}</strong> no banco <strong>{findBank(pay.bankId)}</strong>:
            <b> {money(view.forecast.balances[pay.bankId+":"+pay.invoice.box_id]??0)}</b>
            <p>Se este caixa não possui dinheiro suficiente, transfira primeiro entre caixas com o motivo correto.</p>
          </div>
          {(validCents(pay.amount)>(view.forecast.balances[pay.bankId+":"+pay.invoice.box_id]??0))&&
            <label className={styles.full+" "+styles.dangerCheck}><input type="checkbox" checked={pay.allowNegative}
              onChange={e=>setPay({...pay,allowNegative:e.target.checked})}/>
              Confirmo que o pagamento realmente foi feito, mesmo que este caixa fique negativo no controle.</label>}
          <label className={styles.full}>Observação (opcional)<textarea maxLength={1000} rows={2} value={pay.notes}
            onChange={e=>setPay({...pay,notes:e.target.value})}/></label>
          <div className={styles.formActions}><button type="button" className={styles.secondary}
            onClick={()=>setPay(null)}>Cancelar</button>
            <button type="submit" disabled={busy} className={styles.primary}><Check size={16}/> Registrar pagamento</button></div>
        </form>
      </section></div>}
    {card&&<div className={styles.overlay} onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)setCard(null);}}>
      <section className={styles.modal} role="dialog" aria-modal="true" aria-label="Configurar cartão">
        <div className={styles.modalTitle}><h3>{card.id?"Editar cartão":"Novo cartão"}</h3>
          <button aria-label="Fechar" onClick={()=>setCard(null)}><X size={20}/></button></div>
        <form className={styles.formGrid} onSubmit={e=>void saveCard(e)}>
          <label className={styles.full}>Nome do cartão<input required minLength={2} maxLength={100} value={card.name}
            onChange={e=>setCard({...card,name:e.target.value})}/></label>
          <label>Vencimento (dia do mês)<input required min={1} max={31} type="number"
            value={card.dueDay} onChange={e=>setCard({...card,dueDay:Number(e.target.value)})}/></label>
          <label>Fechamento (opcional)<input type="number" min={1} max={31}
            value={card.closingDay} onChange={e=>setCard({...card,closingDay:e.target.value})}/></label>
          {!card.id&&<label className={styles.full}>Banco associado para referência<select required
            value={card.sourceBankId} onChange={e=>setCard({...card,sourceBankId:e.target.value})}>
            {liveBanks.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
          <label className={styles.full}>Banco provável para pagamento<select value={card.defaultBankId}
            onChange={e=>setCard({...card,defaultBankId:e.target.value})}>
            <option value="">Não definido — escolha ao pagar</option>
            {liveBanks.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          {card.id&&<label className={styles.checkboxLine}><input type="checkbox" checked={card.active}
            onChange={e=>setCard({...card,active:e.target.checked})}/> Cartão ativo</label>}
          <div className={styles.formActions}><button className={styles.secondary} type="button"
            onClick={()=>setCard(null)}>Cancelar</button>
            <button type="submit" className={styles.primary} disabled={busy}>Salvar cartão</button></div>
        </form>
      </section></div>}
    {adjustment&&<div className={styles.overlay} onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)setAdjustment(null);}}>
      <section className={styles.modal} role="dialog" aria-modal="true" aria-label="Ajuste de fatura">
        <div className={styles.modalTitle}><h3>Ajuste de {adjustment.invoice.card_name}</h3>
          <button aria-label="Fechar" onClick={()=>setAdjustment(null)}><X size={20}/></button></div>
        <p className={styles.footnote}>Crédito reduz a fatura; débito acrescenta encargos. Nenhum dos dois movimenta o saldo até pagar a fatura.</p>
        <form className={styles.formGrid} onSubmit={e=>void saveAdjustment(e)}>
          <label>Tipo<select value={adjustment.kind} onChange={e=>setAdjustment({...adjustment,kind:e.target.value as "credit"|"debit"})}>
            <option value="credit">Crédito / abatimento</option><option value="debit">Débito / encargo</option></select></label>
          <label>Valor (R$)<input required type="number" min=".01" step=".01"
            value={adjustment.amount} onChange={e=>setAdjustment({...adjustment,amount:e.target.value})}/></label>
          <label className={styles.full}>Descrição<input required minLength={2} maxLength={160}
            value={adjustment.title} onChange={e=>setAdjustment({...adjustment,title:e.target.value})}/></label>
          <label className={styles.full}>Observações<textarea rows={2} maxLength={1000}
            value={adjustment.notes} onChange={e=>setAdjustment({...adjustment,notes:e.target.value})}/></label>
          <div className={styles.formActions}><button type="button" className={styles.secondary}
            onClick={()=>setAdjustment(null)}>Cancelar</button>
            <button className={styles.primary} disabled={busy}>Registrar ajuste</button></div>
        </form>
      </section></div>}
  </section>;
}
