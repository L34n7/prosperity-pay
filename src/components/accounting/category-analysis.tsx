"use client";

import { useMemo, useState } from "react";
import {
  UtensilsCrossed, Fuel, CarFront, House, Laptop, Repeat2, Plane,
  HeartPulse, Gamepad2, Shirt, Sofa, ShoppingBag, Megaphone,
  Landmark, ReceiptText, BriefcaseBusiness, GraduationCap, ShieldCheck,
  LayoutGrid, Undo2, Search, CalendarDays, Layers3, Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { CashBox, Entry } from "@/lib/accounting/calculations";
import type { CardAdjustment } from "@/lib/accounting/cash-flow";
import { CATEGORY_OPTIONS, summarizeCategories } from "@/lib/accounting/categories";
import type { SummaryCategory, FinanceCategory } from "@/lib/accounting/categories";
import { formatCents } from "@/lib/operational";
import styles from "./category-analysis.module.css";

const icons:Record<SummaryCategory,LucideIcon>={
  alimentacao:UtensilsCrossed,transporte:Fuel,automovel:CarFront,moradia:House,
  tecnologia:Laptop,assinaturas:Repeat2,hospedagem:Plane,saude:HeartPulse,
  lazer:Gamepad2,vestuario:Shirt,casa:Sofa,compras:ShoppingBag,
  marketing:Megaphone,impostos:Landmark,taxas:ReceiptText,
  servicos:BriefcaseBusiness,educacao:GraduationCap,seguros:ShieldCheck,
  outros:LayoutGrid,ajustes:Undo2,
};
export function CategoryIcon({category,size=16}:{category:SummaryCategory;size?:number}){
  const Icon=icons[category]??LayoutGrid;
  return <Icon size={size} aria-hidden="true"/>;
}
type Props = {
  month:string;
  onMonthChange(month:string):void;
  entries:Entry[];
  adjustments:CardAdjustment[];
  boxes:CashBox[];
  onShowEntries(boxId:string,category:FinanceCategory):void;
};

export function CategoryAnalysis({month,onMonthChange,entries,adjustments,boxes,onShowEntries}:Props){
  const [boxId,setBoxId]=useState("");
  const [search,setSearch]=useState("");
  const data=useMemo(()=>summarizeCategories(entries,adjustments,month,boxId),
    [entries,adjustments,month,boxId]);
  const selectedBox=boxes.find(x=>x.id===boxId);
  const visible=data.items.filter(item=>
    item.label.toLocaleLowerCase("pt-BR").includes(search.trim().toLocaleLowerCase("pt-BR")));
  const labelMonth=new Date(month+"-01T12:00:00Z")
    .toLocaleDateString("pt-BR",{month:"long",year:"numeric",timeZone:"UTC"});

  return <section className={styles.root}>
    <div className={styles.head}>
      <div>
        <span className={styles.eyebrow}>Análise financeira · despesas</span>
        <h2>Gastos por categoria</h2>
        <p>Descubra onde estão concentradas suas contas. Cada parcela é contabilizada no próprio mês;
          os valores incluem contas pagas e pendentes, sem duplicar pagamentos de faturas.</p>
      </div>
      <div className={styles.filters}>
        <label><CalendarDays size={15}/> Mês
          <input type="month" min="2020-01" max="2100-12" value={month}
            onChange={e=>{if(e.target.value)onMonthChange(e.target.value)}}/>
        </label>
        <label><Wallet size={15}/> Caixa
          <select value={boxId} onChange={e=>setBoxId(e.target.value)}>
            <option value="">Todos os caixas</option>
            {boxes.map(box=><option key={box.id} value={box.id}>{box.name}</option>)}
          </select>
        </label>
      </div>
    </div>

    <div className={styles.totals}>
      <div className={styles.totalCard}>
        <div className={styles.metricIcon}><Wallet size={18}/></div>
        <span>Total de contas</span>
        <strong>{formatCents(data.netCents)}</strong>
        <small>Total líquido {selectedBox?"· "+selectedBox.name:"· todos os caixas"}</small>
      </div>
      <div className={styles.totalCard}>
        <div className={styles.metricIcon}><ReceiptText size={18}/></div>
        <span>Contas e parcelas</span><strong>{data.count}</strong>
        <small>Despesas cadastradas em {labelMonth}</small>
      </div>
      <div className={styles.totalCard}>
        <div className={styles.metricIcon}><Layers3 size={18}/></div>
        <span>Categorias utilizadas</span><strong>{data.categories}</strong>
        <small>Ordenadas do maior para o menor gasto</small>
      </div>
    </div>

    {data.adjustmentsCents!==0&&<p className={styles.adjustmentsInfo}>
      <Undo2 size={15}/> O total líquido desconta créditos ou soma ajustes de fatura
      ({formatCents(data.adjustmentsCents)}). Esses ajustes aparecem separados, pois não é seguro atribuir
      o crédito automaticamente a uma categoria de compra.
    </p>}

    <div className={styles.listHead}>
      <div><h3>Distribuição das despesas</h3>
        <p>{selectedBox?"Caixa "+selectedBox.name:"Todos os caixas"} · {labelMonth}</p></div>
      <label className={styles.search}><Search size={15}/>
        <input value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="Buscar categoria" aria-label="Buscar categoria"/>
      </label>
    </div>

    <div className={styles.cards}>
      {visible.map((item,index)=>{
        const neg=item.amountCents<0;
        const isAdjustment=item.category==="ajustes";
        return <article key={item.category} className={styles.categoryCard}
          data-tone={String(index%4)}
          style={{animationDelay:Math.min(index*55,660)+"ms"}}>
          <div className={styles.categoryHeader}>
            <span className={styles.categoryIcon}><CategoryIcon category={item.category} size={20}/></span>
            <div className={styles.categoryLabel}>
              <strong>{item.label}</strong>
              <small>{isAdjustment?"Créditos e débitos registrados na fatura":
                item.count+" "+(item.count===1?"conta":"contas")+" no mês"}</small>
            </div>
          </div>
          <strong className={neg?styles.negativeAmount:styles.amount}>
            {neg?"−":""}{formatCents(Math.abs(item.amountCents))}
          </strong>
          {!isAdjustment&&<>
            <div className={styles.progressTrack} role="meter"
              aria-label={"Participação de "+item.label}
              aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(item.percent)}>
              <span style={{width:Math.max(item.percent,0)+"%"}}/>
            </div>
            <div className={styles.cardFooter}>
              <span>{item.percent.toFixed(1).replace(".",",")}% das contas brutas</span>
              <button type="button" onClick={()=>onShowEntries(boxId,item.category as FinanceCategory)}>
                Ver contas
              </button>
            </div>
          </>}
        </article>;
      })}
    </div>
    {data.items.length===0&&<div className={styles.empty}>
      <Layers3 size={28}/><strong>Nenhuma conta cadastrada</strong>
      <p>Selecione outro mês ou caixa, ou inclua contas na Planilha mensal.</p>
    </div>}
    {data.items.length>0&&visible.length===0&&<div className={styles.empty}>
      <Search size={25}/><strong>Nenhuma categoria encontrada</strong>
      <p>Remova a busca para ver todas as categorias deste filtro.</p>
    </div>}
    <p className={styles.disclaimer}>
      A classificação inicial foi baseada no nome das despesas. Para corrigir uma conta, use
      <strong> Habilitar edição</strong> na Planilha mensal e selecione a categoria.
      Títulos genéricos permanecem em “Outros” ou “Compras gerais” até a revisão.
    </p>
  </section>;
}
