import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const content=readFileSync(new URL("../src/lib/accounting/cash-flow.ts",import.meta.url),"utf8");
const js=ts.transpileModule(content,{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
}).outputText;
const module={exports:{}};
vm.runInNewContext(js,{module,exports:module.exports,Date,Map,Intl,Math,Array,Object,Number,Error,Set});
const {
 groupCardInvoices,bankBoxActualBalances,forecastEvents,projectCashFlow,brazilDate,
}=module.exports;
const card={id:"C1",name:"Cartão Inter",owner_user_id:"O1",legacy_bank_id:"Inter",
  default_payment_bank_id:"Inter",due_day:7,closing_day:null,active:true,created_at:""};
function charge(id,box,amount,date="2026-11-07"){
 return {id,owner_user_id:"O1",card_id:"C1",bank_id:"Inter",box_id:box,
  kind:"expense",status:"pending",amount_cents:amount,due_on:date,
  competence_month:date.slice(0,7)+"-01",settled_on:null};
}
function payment(amount,box="Leandro"){
 return {id:"P1",owner_user_id:"O1",card_id:"C1",box_id:box,
  invoice_month:"2026-11-01",bank_id:"Inter",amount_cents:amount,
  paid_at:"2026-11-06T15:00:00-03:00"};
}
test("a fatura soma compras e subtrai credito e pagamento, sem debitar compras",()=>{
 const charges=[charge("1","Leandro",200000),charge("2","Leandro",103726)];
 const adjustments=[{card_id:"C1",box_id:"Leandro",invoice_month:"2026-11-01",kind:"credit",amount_cents:50376}];
 const invoices=groupCardInvoices([card],charges,[],adjustments);
 assert.equal(invoices.length,1);
 assert.equal(invoices[0].remaining_cents,253350);
 const paid=groupCardInvoices([card],charges,[payment(100000)],adjustments);
 assert.equal(paid[0].remaining_cents,153350);
 const balance=bankBoxActualBalances(charges,[],[],"2026-11-06");
 assert.equal(balance["Inter:Leandro"]??0,0);
});
test("saldo considera pagamento real e recebimento confirmado, mas nunca previsto",()=>{
 const entries=[{id:"D",kind:"opening",status:"paid",card_id:null,
   bank_id:"Inter",box_id:"CRM",amount_cents:50000,settled_on:"2026-10-01"}];
 const receipts=[
  {status:"expected",bank_id:"Inter",box_id:"CRM",amount_cents:90000,expected_on:"2026-11-09"},
  {status:"received",bank_id:"Inter",box_id:"CRM",amount_cents:20000,received_at:"2026-11-05T09:00:00-03:00"},
 ];
 assert.equal(bankBoxActualBalances(entries,[payment(10000,"CRM")],receipts,"2026-11-06")["Inter:CRM"],60000);
});
test("projecao detecta falta antes do recebimento futuro",()=>{
 const invoices=[{key:"C1|CRM|2026-11-01",card_id:"C1",box_id:"CRM",card_name:"Inter",
   invoice_month:"2026-11-01",due_on:"2026-11-07",remaining_cents:15000,
   default_payment_bank_id:"Inter"}];
 const receipts=[{id:"R1",status:"expected",bank_id:"Inter",box_id:"CRM",
   expected_on:"2026-11-09",amount_cents:20000,title:"Cliente"}];
 const events=forecastEvents([],invoices,receipts,"2026-11-06");
 const result=projectCashFlow({start:"2026-11-06",days:7,balances:{"Inter:CRM":10000},events});
 assert.equal(result.first_shortfall_date,"2026-11-07");
 assert.equal(result.minimum_cents,-5000);
 assert.equal(result.final_cents,15000);
});
test("saldo de Lucas nao compensa falta de caixa do CRM",()=>{
 const events=[{key:"expense:X",kind:"expense",title:"Conta",date:"2026-11-07",
   original_date:"2026-11-07",bank_id:"Inter",box_id:"CRM",amount_cents:-40000,overdue:false}];
 const balances={"Inter:Lucas":120000,"Inter:CRM":10000};
 const all=projectCashFlow({start:"2026-11-06",days:3,balances,events});
 const onlyCRM=projectCashFlow({start:"2026-11-06",days:3,balances,events,boxId:"CRM"});
 assert.equal(all.first_shortfall_date,null);
 assert.equal(onlyCRM.first_shortfall_date,"2026-11-07");
 assert.equal(onlyCRM.minimum_cents,-30000);
});
test("fatura sem banco definido conta no global e sinaliza incompleto no filtro de banco",()=>{
 const invoices=[{key:"C1|CRM|2026-11-01",card_id:"C1",box_id:"CRM",card_name:"Cartão Carrefour",
   invoice_month:"2026-11-01",due_on:"2026-11-10",remaining_cents:20000,
   default_payment_bank_id:null}];
 const events=forecastEvents([],invoices,[],"2026-11-06");
 const combined=projectCashFlow({start:"2026-11-06",days:10,balances:{"Inter:CRM":30000},events});
 const bank=projectCashFlow({start:"2026-11-06",days:10,balances:{"Inter:CRM":30000},events,bankId:"Inter"});
 assert.equal(combined.final_cents,10000);
 assert.equal(bank.final_cents,30000);
 assert.equal(bank.unassigned_cents,20000);
});
test("datas reais interpretadas no horario brasileiro",()=>{
 assert.equal(brazilDate("2026-11-06T01:30:00Z"),"2026-11-05");
});
