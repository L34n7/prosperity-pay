"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownCircle, ArrowLeftRight, ArrowUpCircle, CalendarDays, Download, Pencil,
  Plus, Search, Wallet } from "lucide-react";
import type { Bank, CashBox, Entry } from "@/lib/accounting/calculations";
import type { Card, CardPayment, ExpectedIncome } from "@/lib/accounting/cash-flow";
import { brazilDate } from "@/lib/accounting/cash-flow";
import { collectBankMovements, filterBankMovements, movementSignedAmount,
  movementMonthTone, paginateMovements, sumMovements } from "@/lib/accounting/movements";
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
};

type KindFilter = "all" | MovementKind;
const kindLabels: Record<MovementKind,string> = {
  income:"Entrada",outflow:"Saída / Pix",transfer:"Transferência",
  opening:"Saldo inicial / aporte",bill_payment:"Conta paga",card_payment:"Fatura paga",
};
function labelMonth(date:string){
  const label=new Date(date.slice(0,7)+"-01T12:00:00Z")
    .toLocaleDateString("pt-BR",{timeZone:"UTC",month:"long",year:"numeric"});
  return label.charAt(0).toLocaleUpperCase("pt-BR")+label.slice(1);
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
  entries,payments,receipts,cards,banks,boxes,onNew,onEdit,
}:Props){
  const [kind,setKind]=useState<KindFilter>("all");
  const [bankId,setBankId]=useState("");
  const [boxId,setBoxId]=useState("");
  const [search,setSearch]=useState("");
  const [page,setPage]=useState(1);
  const tableTopRef=useRef<HTMLDivElement>(null);
  const fullList=useMemo(()=>collectBankMovements(entries,payments,receipts,cards),
    [entries,payments,receipts,cards]);
  // Histórico completo, independente da competência selecionada no módulo.
  const filtered=useMemo(()=>filterBankMovements(fullList,{
    kind,bankId,boxId,search,
  }),[fullList,kind,bankId,boxId,search]);
  const summary=useMemo(()=>sumMovements(filtered,bankId,boxId),[filtered,bankId,boxId]);
  useEffect(()=>setPage(1),[kind,bankId,boxId,search]);
  const pagination=useMemo(()=>paginateMovements(filtered,page),[filtered,page]);
  const visible=pagination.items;
  const displayedPages=useMemo(()=>Array.from({length:pagination.totalPages},(_,i)=>i+1)
    .filter(n=>n===1||n===pagination.totalPages||Math.abs(n-pagination.page)<=1),
    [pagination.totalPages,pagination.page]);
  const bankName=(id:string|null)=>banks.find(b=>b.id===id)?.name??"Banco não identificado";
  const boxName=(id:string|null)=>boxes.find(b=>b.id===id)?.name??"Caixa não identificado";

  function goPage(nextPage:number){
    setPage(Math.max(1,Math.min(pagination.totalPages,nextPage)));
    tableTopRef.current?.scrollIntoView({behavior:"smooth",block:"start"});
  }
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
    anchor.href=url;anchor.download="extrato-movimentacoes.csv";
    document.body.appendChild(anchor);anchor.click();anchor.remove();URL.revokeObjectURL(url);
  }

  return <section className={styles.root}>
    <div className={styles.top}>
      <div><span className={styles.eyebrow}>Extrato financeiro · bancos e caixas</span>
        <h2>Movimentações</h2>
        <p>Histórico completo, com as movimentações mais recentes primeiro. Entradas, Pix enviados, pagamentos e transferências realmente registrados.
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
      <div><span>Movimentações</span><strong>{summary.count}</strong><small>Confirmadas no histórico</small></div>
      <div><span>Entradas</span><strong className={styles.positive}>{money(summary.inCents)}</strong><small>Inclui aportes e saldo inicial</small></div>
      <div><span>Saídas</span><strong className={styles.negative}>{money(summary.outCents)}</strong><small>Inclui pagamentos bancários</small></div>
      <div><span>Transferências</span><strong>{money(summary.transferCents)}</strong><small>Não duplicam o saldo total</small></div>
      <div><span>Variação do histórico</span><strong className={summary.netCents<0?styles.negative:styles.positive}>
        {summary.netCents<0?"−":summary.netCents>0?"+":""}{money(Math.abs(summary.netCents))}</strong>
        <small>Movimentações filtradas, não saldo atual</small></div>
    </div>

    <div ref={tableTopRef} className={styles.tableHeader}>
      <div><h3>Últimas movimentações</h3>
        <p>{summary.count} registros · 50 movimentações por página · agrupadas por mês</p></div>
      <button type="button" className={styles.secondary} disabled={!filtered.length}
        onClick={exportCsv}><Download size={16}/> Exportar CSV</button>
    </div>

    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead><tr>
          <th>Data</th><th>Descrição</th><th>Tipo</th><th>Banco / Conta</th>
          <th>Caixa</th><th>Valor</th><th aria-label="Ações">Ações</th>
        </tr></thead>
        <tbody>{visible.map((m,index)=>{
          const signed=movementSignedAmount(m,bankId,boxId);
          const neutral=m.kind==="transfer" && signed===0;
          const month=m.date.slice(0,7);
          const tone=movementMonthTone(m.date);
          const startsMonth=index===0||visible[index-1].date.slice(0,7)!==month;
          const toneClass=tone===0?styles.monthTone0:tone===1?styles.monthTone1:styles.monthTone2;
          const dividerClass=tone===0?styles.monthDivider0:tone===1?styles.monthDivider1:styles.monthDivider2;
          return <Fragment key={m.id}>
            {startsMonth&&<tr className={dividerClass}>
              <td colSpan={7}><span className={styles.monthDividerText}>{labelMonth(m.date)}</span>
                <span className={styles.monthDividerHint}>Movimentações do mês</span></td>
            </tr>}
            <tr className={toneClass}>
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
          </tr></Fragment>;
        })}</tbody>
      </table>
      {!visible.length&&<div className={styles.empty}>
        <Wallet size={26}/><strong>Nenhuma movimentação neste filtro</strong>
        <p>Experimente selecionar “Todas as movimentações” ou limpar os filtros de banco, caixa e busca.</p>
      </div>}
    </div>
    <nav className={styles.pager} aria-label="Paginação das movimentações">
      <span>{pagination.total>0
        ? "Exibindo "+(pagination.start+1)+"–"+Math.min(pagination.start+pagination.pageSize,pagination.total)+" de "+pagination.total
        : "Nenhuma movimentação"} · Página {pagination.page} de {pagination.totalPages}</span>
      <div className={styles.pageControls}>
        <button type="button" className={styles.secondary} disabled={pagination.page<=1}
          onClick={()=>goPage(pagination.page-1)}>Anterior</button>
        {displayedPages.map((pageNumber,index)=><Fragment key={pageNumber}>
          {index>0&&pageNumber-displayedPages[index-1]>1&&<span aria-hidden="true" className={styles.pageEllipsis}>…</span>}
          <button type="button" aria-label={"Ir para página "+pageNumber}
            aria-current={pagination.page===pageNumber?"page":undefined}
            className={pagination.page===pageNumber?styles.pageActive:styles.pageNumber}
            onClick={()=>goPage(pageNumber)}>{pageNumber}</button>
        </Fragment>)}
        <button type="button" className={styles.secondary}
          disabled={pagination.page>=pagination.totalPages}
          onClick={()=>goPage(pagination.page+1)}>Próxima</button>
      </div>
    </nav>
    <div className={styles.footnote}>
      <CalendarDays size={15}/> Este relatório considera a data efetiva dos lançamentos registrados.
      Operações importadas sem hora verdadeira mostram “Horário não informado”.
      Transferências internas não criam receita nem despesa quando consideradas em conjunto.
    </div>
  </section>;
}
