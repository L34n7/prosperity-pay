import type { Database } from "@/lib/supabase/database.current.types";
export type Card = Database["public"]["Tables"]["finance_cards"]["Row"];
export type CardPayment = Database["public"]["Tables"]["finance_card_payments"]["Row"];
export type CardAdjustment = Database["public"]["Tables"]["finance_card_adjustments"]["Row"];
export type ExpectedIncome = Database["public"]["Tables"]["finance_expected_incomes"]["Row"];
export type LedgerEntry = Database["public"]["Tables"]["finance_entries"]["Row"];
export type FinancialBank = Database["public"]["Tables"]["finance_banks"]["Row"];

export type CardInvoice = {
  key: string; card_id: string; card_name: string; box_id: string;
  invoice_month: string; due_on: string; total_cents: number;
  adjustment_cents: number; paid_cents: number; remaining_cents: number; charges: number;
  default_payment_bank_id: string | null;
};
export type ForecastEvent = {
  key: string; date: string; original_date: string;
  kind: "card" | "expense" | "income";
  title: string; bank_id: string | null; box_id: string;
  amount_cents: number;
  card_id?: string; invoice_month?: string;
  overdue: boolean;
};
export type DailyForecast = {
  date: string; incoming_cents: number; outgoing_cents: number;
  balance_cents: number; items: ForecastEvent[];
};
export type Projection = {
  starting_cents: number; expected_in_cents: number; scheduled_out_cents: number;
  final_cents: number; minimum_cents: number; first_shortfall_date: string | null;
  unassigned_cents: number; days: DailyForecast[];
  events: ForecastEvent[];
};
export function brazilDate(instant: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {timeZone:"America/Sao_Paulo",
    year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(instant));
  const get = (key:string) => parts.find(p=>p.type===key)?.value ?? "";
  return get("year")+"-"+get("month")+"-"+get("day");
}
const monthOf = (day: string) => day.slice(0,7)+"-01";
export function dayPlus(day:string,n:number) {
  const dt=new Date(day+"T12:00:00Z");dt.setUTCDate(dt.getUTCDate()+n);
  return dt.toISOString().slice(0,10);
}
export function invoiceKey(cardId:string, boxId:string,month:string) {
  return cardId+"|"+boxId+"|"+month;
}
/** As compras no cartao continuam pendentes: apenas o pagamento real abate banco/caixa. */
export function groupCardInvoices(cards:Card[], entries:LedgerEntry[],payments:CardPayment[],adjustments:CardAdjustment[]=[]):CardInvoice[] {
  const map = new Map<string,CardInvoice>();
  const cardsById=new Map(cards.map(x=>[x.id,x]));
  for(const e of entries) {
    if (!e.card_id || e.kind!=="expense" || !e.due_on) continue;
    const c=cardsById.get(e.card_id); if(!c) continue;
    const month=monthOf(e.due_on),key=invoiceKey(c.id,e.box_id,month);
    let row=map.get(key);
    if(!row) {
      row={key,card_id:c.id,card_name:c.name,box_id:e.box_id,invoice_month:month,
        due_on:e.due_on,total_cents:0,adjustment_cents:0,paid_cents:0,remaining_cents:0,
        charges:0,default_payment_bank_id:c.default_payment_bank_id};
      map.set(key,row);
    }
    row.total_cents+=e.amount_cents;
    row.charges++;
    if(e.due_on<row.due_on)row.due_on=e.due_on;
  }
  for(const a of adjustments){
    const row=map.get(invoiceKey(a.card_id,a.box_id,a.invoice_month));
    if(row)row.adjustment_cents+=(a.kind==="credit"?-a.amount_cents:a.amount_cents);
  }
  for(const p of payments){
    const row=map.get(invoiceKey(p.card_id,p.box_id,p.invoice_month));
    if(row)row.paid_cents+=p.amount_cents;
  }
  return [...map.values()].map(r=>({...r,remaining_cents:Math.max(0,r.total_cents+r.adjustment_cents-r.paid_cents)}))
    .sort((a,b)=>a.due_on.localeCompare(b.due_on)||a.card_name.localeCompare(b.card_name));
}
/** Saldo de verdade: entradas confirmadas, pagamentos e transferencias; previsoes nunca entram aqui. */
export function bankBoxActualBalances(
 entries:LedgerEntry[],payments:CardPayment[],receipts:ExpectedIncome[],upTo:string,
):Record<string,number>{
  const balances:Record<string,number>={};
  const change=(bank:string,box:string,amount:number)=>{
    const k=bank+":"+box;balances[k]=(balances[k]??0)+amount;
  };
  for(const e of entries){
    if(e.status!=="paid" || e.card_id || !e.settled_on || e.settled_on>upTo)continue;
    if(e.kind==="transfer"){
      change(e.bank_id,e.box_id,-e.amount_cents);
      if(e.target_bank_id&&e.target_box_id)change(e.target_bank_id,e.target_box_id,e.amount_cents);
    }else change(e.bank_id,e.box_id,((e.kind==="expense"||e.kind==="outflow")?-1:1)*e.amount_cents);
  }
  for(const p of payments)if(brazilDate(p.paid_at)<=upTo)change(p.bank_id,p.box_id,-p.amount_cents);
  for(const r of receipts)if(r.status==="received"&&r.received_at&&brazilDate(r.received_at)<=upTo)
    change(r.bank_id,r.box_id,r.amount_cents);
  return balances;
}
export function forecastEvents(
 entries:LedgerEntry[], invoices:CardInvoice[],receipts:ExpectedIncome[],start:string,
):ForecastEvent[]{
  const result:ForecastEvent[]=[];
  const effective=(day:string)=>day<start?start:day;
  for(const e of entries){
    if(e.kind!=="expense"||e.status!=="pending"||e.card_id||!e.due_on)continue;
    result.push({key:"expense:"+e.id,date:effective(e.due_on),original_date:e.due_on,
      kind:"expense",title:e.title,bank_id:e.bank_id,box_id:e.box_id,
      amount_cents:-e.amount_cents,overdue:e.due_on<start});
  }
  for(const inv of invoices){
    if(!inv.remaining_cents)continue;
    result.push({key:"card:"+inv.key,date:effective(inv.due_on),original_date:inv.due_on,
      kind:"card",title:inv.card_name+" · "+inv.invoice_month.slice(0,7),
      bank_id:inv.default_payment_bank_id,box_id:inv.box_id,
      amount_cents:-inv.remaining_cents,card_id:inv.card_id,invoice_month:inv.invoice_month,
      overdue:inv.due_on<start});
  }
  for(const r of receipts){
    if(r.status!=="expected")continue;
    result.push({key:"income:"+r.id,date:effective(r.expected_on),original_date:r.expected_on,
      kind:"income",title:r.title,bank_id:r.bank_id,box_id:r.box_id,
      amount_cents:r.amount_cents,overdue:r.expected_on<start});
  }
  return result.sort((a,b)=>a.date.localeCompare(b.date)||a.key.localeCompare(b.key));
}
/** Receita esperada melhora o previsto, NUNCA o saldo real.
 * Contas sem banco de pagamento definido entram no consolidado mas nao no filtro de banco;
 * a interface deve explicitar que precisam de configuracao.
 */
export function projectCashFlow(input:{
  start:string;days:number;balances:Record<string,number>;
  events:ForecastEvent[];bankId?:string;boxId?:string;
}):Projection {
  const {start,days,balances,events,bankId,boxId}=input;
  if(!Number.isInteger(days)||days<1||days>366)throw new Error("Horizonte invalido");
  const end=dayPlus(start,days-1);
  let opening=0;
  for(const [key,value] of Object.entries(balances)){
    const split=key.indexOf(":");const bank=key.slice(0,split),box=key.slice(split+1);
    if((!bankId||bank===bankId)&&(!boxId||box===boxId))opening+=value;
  }
  const relevant=events.filter(e=>e.date>=start&&e.date<=end&&(!boxId||e.box_id===boxId)&&
    (!bankId||e.bank_id===bankId));
  const unassigned=events.filter(e=>e.date>=start&&e.date<=end&&e.bank_id===null&&
    (!boxId||e.box_id===boxId)).reduce((sum,e)=>sum-Math.min(0,e.amount_cents),0);
  const byDate=new Map<string,ForecastEvent[]>();
  for(const e of relevant)byDate.set(e.date,[...(byDate.get(e.date)??[]),e]);
  let balance=opening,minimum=opening,firstShortfall:string|null=opening<0?start:null;
  let scheduled=0,incoming=0;
  const daily:DailyForecast[]=[];
  for(let n=0;n<days;n++){
    const date=dayPlus(start,n),items=byDate.get(date)??[];
    let inc=0,out=0;
    for(const e of items){if(e.amount_cents>0)inc+=e.amount_cents;else out-=e.amount_cents;}
    balance+=inc-out;incoming+=inc;scheduled+=out;
    if(balance<minimum)minimum=balance;
    if(!firstShortfall&&balance<0)firstShortfall=date;
    daily.push({date,incoming_cents:inc,outgoing_cents:out,balance_cents:balance,items});
  }
  return {starting_cents:opening,expected_in_cents:incoming,scheduled_out_cents:scheduled,
    final_cents:balance,minimum_cents:minimum,first_shortfall_date:firstShortfall,
    unassigned_cents:unassigned,days:daily,events:relevant};
}
export function invoiceDueDate(month:string, day:number) {
  const [y,m]=month.split("-").map(Number);
  return month.slice(0,7)+"-"+String(Math.min(day,new Date(Date.UTC(y,m,0)).getUTCDate())).padStart(2,"0");
}
