"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDownCircle, ArrowLeftRight, ArrowUpCircle, CalendarDays, Download, Pencil,
  Plus, Search, Wallet } from "lucide-react";
import type { Bank, CashBox, Entry } from "@/lib/accounting/calculations";
import type { Card, CardPayment, ExpectedIncome } from "@/lib/accounting/cash-flow";
import { brazilDate } from "@/lib/accounting/cash-flow";
import { collectBankMovements, filterBankMovements, movementSignedAmount,
  reportMonthBounds, shiftReportDay, sumMovements } from "@/lib/accounting/movements";
import type { BankMovement, MovementKind } from "@/lib/accounting/movements";
import { formatCents } from "@/lib/operational";
import styles from "./movements-report.module.css";

type Props = {
  entries: Entry[];
  payments: CardPayment[];
  receipts: ExpectedIncome[];
  cards: Card[];
  banks: Bank[];
  boxes: CashBox[];
  onNew(kind: "opening" | "income" | "outflow" | "transfer"):void;
  onEdit(entryId:string):void;
  onEndDateChange(date:string):void;
};

type Preset = "60" | "30" | "90" | "month" | "previous" | "all" | "custom";
type KindFilter = "all" | MovementKind;
const kindLabels: Record<MovementKind,string> = {
  income:"Entrada",outflow:"Saída / Pix",transfer:"Transferência",
  opening:"Saldo inicial / aporte",bill_payment:"Conta paga",card_payment:"Fatura paga",
};
function brazilToday() {
  const parts = new Intl.DateTimeFormat("en-US",{
    timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit",
  }).formatToParts(new Date());
  const p=(key:string)=>parts.find(part=>part.type===key)?.value??"";
  return p("year")+"-"+p("month")+"-"+p("day");
}
function prevMonth(today:string){
  const first=new Date(today.slice(0,7)+"-01T12:00:00Z");
  first.setUTCMonth(first.getUTCMonth()-1);
  return first.toISOString().slice(0,7);
}
function presetBounds(preset:Preset,today:string){
  if(preset==="month")return reportMonthBounds(today.slice(0,7));
  if(preset==="previous")return reportMonthBounds(prevMonth(today));
  if(preset==="all")return {start:"2020-01-01",end:today};
  return {start:shiftReportDay(today,1-Number(preset)),end:today};
}
function shortDate(iso:string){
  return new Date(iso+"T12:00:00Z").toLocaleDateString("pt-BR",{day:"2-digit",month:"short",year:"numeric",timeZone:"UTC"});
}
function money(value:number){return formatCents(value)}
function localTime(movement:BankMovement){
  if(!movement.timestamp||movement.hour_is_estimated)return "Horário não informado";
  return new Intl.DateTimeFormat("pt-BR",{
    timeZone:"America/Sao_Paulo",hour:"2-digit",minute:"2-digit",
  }).format(new Date(movement.timestamp));
}
function csvCell(input:string){
  const safe=/^[=+@\-\t\r]/.test(input)?"'"+input:input;
  return '"'+safe.replaceAll('"','""')+'"';
}
export function MovementsReport({
  entries,payments,receipts,cards,banks,boxes,onNew,onEdit,onEndDateChange,
}:Props){
  const [preset,setPreset]=useState<Preset>("60");
  const today=brazilToday();
  const [start,setStart]=useState(()=>presetBounds("60",brazilToday()).start);
  const [end,setEnd]=useState(()=>brazilToday());
  const [kind,setKind]=useState<KindFilter>("all");
  const [bankId,setBankId]=useState("");
  const [boxId,setBoxId]=useState("");
  const [search,setSearch]=useState("");
  const [limit,setLimit]=useState(40);

  const fullList=useMemo(()=>collectBankMovements(entries,payments,receipts,cards),
    [entries,payments,receipts,cards]);
  const filtered=useMemo(()=>filterBankMovements(fullList,{
    start,end,kind,bankId,boxId,search,
  }),[fullList,start,end,kind,bankId,boxId,search]);
  const summary=useMemo(()=>sumMovements(filtered,bankId,boxId),[filtered,bankId,boxId]);
  useEffect(()=>setLimit(40),[start,end,kind,bankId,boxId,search]);
  const visible=filtered.slice(0,limit);
  const bankName=(id:string|null)=>banks.find(b=>b.id===id)?.name??"Banco não identificado";
  const boxName=(id:string|null)=>boxes.find(b=>b.id===id)?.name??"Caixa não identificado";

  function applyPreset(choice:Preset){
    setPreset(choice);
    if(choice==="custom")return;
    const range=presetBounds(choice,today);
    setStart(range.start);setEnd(range.end);onEndDateChange(range.end);
  }
  function updateStart(value:string){setPreset("custom");setStart(value);}
  function updateEnd(value:string){setPreset("custom");setEnd(value);onEndDateChange(value);}
  function exportCsv(){
    const columns=["Data","Horário","Movimentação","Tipo","Banco origem","Caixa origem",
      "Banco destino","Caixa destino","Valor (R$)","Observações"];
    const values=filtered.map(m=>{
      const signed=movementSignedAmount(m,bankId,boxId);
      return [m.date,m.hour_is_estimated?"":localTime(m),m.title,kindLabels[m.kind],
        bankName(m.bank_id),boxName(m.box_id),
        m.target_bank_id?bankName(m.target_bank_id):"",m.target_box_id?boxName(m.target_box_id):"",
        (signed/100).toFixed(2).replace(".",","),m.notes??""];
    });
    const csv="\ufeff"+[columns,...values].map(row=>row.map(csvCell).join(";")).join("\r\n");
    const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});
    const url=URL.createObjectURL(blob),anchor=document.createElement("a");
    anchor.href=url;anchor.download="movimentacoes-"+start+"-a-"+end+".csv";
    document.body.appendChild(anchor);anchor.click();anchor.remove();URL.revokeObjectURL(url);
  }

  return <section className={styles.root}>
    <div className={styles.top}>
      <div><span className={styles.eyebrow}>Extrato financeiro · bancos e caixas</span>
        <h2>Movimentações</h2>
        <p>Todas as entradas, Pix enviados, pagamentos e transferências realmente registrados.
          Compras de cartão e contas ainda pendentes ficam fora deste extrato.</p>
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} onClick={()=>onNew("income")}><ArrowUpCircle size={16}/> Entrada</button>
        <button type="button" className={styles.secondary} onClick={()=>onNew("outflow")}><ArrowDownCircle size={16}/> Saída / Pix</button>
        <button type="button" className={styles.secondary} onClick={()=>onNew("transfer")}><ArrowLeftRight size={16}/> Transferência</button>
        <button type="button" className={styles.secondary} onClick={()=>onNew("opening")}><Plus size={16}/> Saldo / aporte</button>
      </div>
    </div>

    <div className={styles.filters}>
      <label>Período
        <select value={preset} onChange={e=>applyPreset(e.target.value as Preset)}>
          <option value="60">Últimos 60 dias</option>
          <option value="30">Últimos 30 dias</option>
          <option value="90">Últimos 90 dias</option>
          <option value="month">Mês atual</option>
          <option value="previous">Mês anterior</option>
          <option value="all">Todo o histórico</option>
          <option value="custom">Personalizado</option>
        </select>
      </label>
      <label>De<input aria-label="Data inicial" type="date" value={start} min="2020-01-01" max="2100-12-31"
        onChange={e=>updateStart(e.target.value)}/></label>
      <label>Até<input aria-label="Data final" type="date" value={end} min="2020-01-01" max="2100-12-31"
        onChange={e=>updateEnd(e.target.value)}/></label>
      <label>Tipo
        <select aria-label="Filtrar tipo de movimentação" value={kind}
          onChange={e=>setKind(e.target.value as KindFilter)}>
          <option value="all">Todas as movimentações</option>
          <option value="income">Apenas entradas</option>
          <option value="outflow">Apenas saídas / Pix</option>
          <option value="transfer">Apenas transferências</option>
          <option value="opening">Saldos / aportes</option>
          <option value="bill_payment">Pagamentos de contas</option>
          <option value="card_payment">Pagamentos de faturas</option>
        </select>
      </label>
      <label>Banco
        <select aria-label="Filtrar banco da movimentação" value={bankId} onChange={e=>setBankId(e.target.value)}>
          <option value="">Todos os bancos</option>
          {banks.map(b=><option key={b.id} value={b.id}>{b.name}{b.active?"":" · arquivado"}</option>)}
        </select>
      </label>
      <label>Caixa
        <select aria-label="Filtrar caixa da movimentação" value={boxId} onChange={e=>setBoxId(e.target.value)}>
          <option value="">Todos os caixas</option>
          {boxes.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </label>
      <label className={styles.search}><span>Buscar movimentação</span>
        <div><Search size={16}/><input aria-label="Buscar movimentação"
          value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="Descrição, nome ou observação"/></div>
      </label>
    </div>

    <div className={styles.metrics}>
      <div><span>Movimentações</span><strong>{summary.count}</strong><small>Confirmadas no período</small></div>
      <div><span>Entradas</span><strong className={styles.positive}>{money(summary.inCents)}</strong><small>Inclui aportes e saldo inicial</small></div>
      <div><span>Saídas</span><strong className={styles.negative}>{money(summary.outCents)}</strong><small>Inclui pagamentos bancários</small></div>
      <div><span>Transferências</span><strong>{money(summary.transferCents)}</strong><small>Não duplicam o saldo total</small></div>
      <div><span>Variação no período</span><strong className={summary.netCents<0?styles.negative:styles.positive}>
        {summary.netCents<0?"−":summary.netCents>0?"+":""}{money(Math.abs(summary.netCents))}</strong>
        <small>Movimentações filtradas, não saldo atual</small></div>
    </div>

    <div className={styles.tableHeader}>
      <div><h3>Extrato de movimentações</h3>
        <p>{start&&end?shortDate(start)+" a "+shortDate(end):"Selecione o período"} · {summary.count} registros</p></div>
      <button type="button" className={styles.secondary} disabled={!filtered.length}
        onClick={exportCsv}><Download size={16}/> Exportar CSV</button>
    </div>

    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead><tr>
          <th>Data</th><th>Descrição</th><th>Tipo</th><th>Banco / Conta</th>
          <th>Caixa</th><th>Valor</th><th aria-label="Ações">Ações</th>
        </tr></thead>
        <tbody>{visible.map(m=>{
          const signed=movementSignedAmount(m,bankId,boxId);
          const neutral=m.kind==="transfer" && signed===0;
          return <tr key={m.id}>
            <td className={styles.date}><strong>{shortDate(m.date)}</strong>
              <small>{localTime(m)}</small></td>
            <td className={styles.description}><strong>{m.title}</strong>
              {m.kind==="transfer"&&<small>De {bankName(m.bank_id)} / {boxName(m.box_id)} para {bankName(m.target_bank_id)} / {boxName(m.target_box_id)}</small>}
              {m.source==="expected_income"&&<small>Recebimento previsto confirmado</small>}
              {m.notes&&m.kind!=="transfer"&&<small title={m.notes}>{m.notes}</small>}</td>
            <td><span className={m.kind==="income"||m.kind==="opening"?styles.inBadge:
              m.kind==="transfer"?styles.transferBadge:styles.outBadge}>
              {kindLabels[m.kind]}</span></td>
            <td><strong>{bankName(m.bank_id)}</strong>
              {m.kind==="transfer"&&<small>→ {bankName(m.target_bank_id)}</small>}</td>
            <td><strong>{boxName(m.box_id)}</strong>
              {m.kind==="transfer"&&<small>→ {boxName(m.target_box_id)}</small>}</td>
            <td className={neutral?styles.amountNeutral:signed<0?styles.amountOut:styles.amountIn}>
              {neutral?"↔":signed<0?"−":"+"}{money(neutral?m.amount_cents:Math.abs(signed))}
            </td>
            <td>{m.entry_id&&<button className={styles.edit} type="button"
              title="Editar movimentação" onClick={()=>onEdit(m.entry_id!)}><Pencil size={15}/></button>}</td>
          </tr>;
        })}</tbody>
      </table>
      {!visible.length&&<div className={styles.empty}>
        <Wallet size={26}/><strong>Nenhuma movimentação neste filtro</strong>
        <p>Experimente ampliar o período ou selecionar “Todas as movimentações”.</p>
      </div>}
    </div>
    {limit<filtered.length&&<div className={styles.pager}>
      <span>Exibindo {visible.length} de {filtered.length} movimentações</span>
      <button className={styles.secondary} type="button" onClick={()=>setLimit(x=>x+40)}>Mostrar mais 40</button>
    </div>}
    <div className={styles.footnote}>
      <CalendarDays size={15}/> Este relatório considera a data efetiva dos lançamentos registrados.
      Operações importadas sem hora verdadeira mostram “Horário não informado”.
      Transferências internas não criam receita nem despesa quando consideradas em conjunto.
    </div>
  </section>;
}
