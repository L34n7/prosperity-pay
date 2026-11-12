import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import vm from "node:vm";
import ts from "typescript";

const content=readFileSync(new URL("../src/lib/accounting/categories.ts",import.meta.url),"utf8");
const compiled=ts.transpileModule(content,{compilerOptions:{
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,
}}).outputText;
const module={exports:{}};
vm.runInNewContext(compiled,{module,exports:module.exports,Map,Set,Number,Object,Array,RegExp,Error});
const {CATEGORY_OPTIONS,suggestCategory,isFinanceCategory,summarizeCategories}=module.exports;

function expense(id,category,box,month,amount){
 return {id,kind:"expense",category,box_id:box,competence_month:month+"-01",amount_cents:amount};
}

test("20 categorias distintas, incluindo Produto",()=>{
 assert.equal(CATEGORY_OPTIONS.length,20);
 assert.equal(new Set(CATEGORY_OPTIONS.map(x=>x.key)).size,20);
 assert.ok(isFinanceCategory("alimentacao"));
 assert.ok(isFinanceCategory("produto"));
 assert.ok(!isFinanceCategory("not_category"));
 assert.equal(suggestCategory("JIM.COM* TATIANA FERR"),"outros");
 assert.equal(suggestCategory("MERCADOLIVRE*MERCADOLIVRE"),"compras");
 assert.equal(suggestCategory("IFD*KIFAK ESFIHAS ARTE"),"alimentacao");
 assert.equal(suggestCategory("BURGER KING App"),"alimentacao");
 assert.equal(suggestCategory("POSTO 264 PCC CONTAGEM"),"transporte");
 assert.equal(suggestCategory("VERCEL INC."),"tecnologia");
 assert.equal(suggestCategory("AIRBNB *HMMJQCF"),"hospedagem");
});

const expenses=[
 expense("a","alimentacao","crm","2026-11",15000),
 expense("b","alimentacao","leandro","2026-11",10000),
 expense("c","tecnologia","crm","2026-11",80000),
 expense("d","outros","lucas","2026-11",12000),
 expense("e","alimentacao","crm","2026-12",200000),
 {...expense("f","alimentacao","crm","2026-11",50000),kind:"income"},
];
const adjustments=[
 {invoice_month:"2026-11-01",box_id:"crm",kind:"credit",amount_cents:12500},
 {invoice_month:"2026-11-01",box_id:"leandro",kind:"debit",amount_cents:2500},
 {invoice_month:"2026-12-01",box_id:"crm",kind:"credit",amount_cents:4000},
];
test("soma as contas apenas do mês escolhido e ordena categorias por maior valor",()=>{
 const r=summarizeCategories(expenses,adjustments,"2026-11");
 assert.equal(r.count,4);
 assert.equal(r.grossCents,117000);
 assert.equal(r.adjustmentsCents,-10000);
 assert.equal(r.netCents,107000);
 assert.equal(r.items[0].category,"tecnologia");
 assert.equal(r.items[0].amountCents,80000);
 assert.equal(r.items.find(i=>i.category==="alimentacao").amountCents,25000);
 assert.equal(r.items.at(-1).category,"ajustes");
 assert.equal(r.items.at(-1).amountCents,-10000);
});
test("filtro de caixa não mistura crédito nem contas de outros responsáveis",()=>{
 const r=summarizeCategories(expenses,adjustments,"2026-11","crm");
 assert.equal(r.count,2);
 assert.equal(r.grossCents,95000);
 assert.equal(r.adjustmentsCents,-12500);
 assert.equal(r.netCents,82500);
 assert.equal(r.items.find(i=>i.category==="alimentacao").amountCents,15000);
 assert.equal(r.items.some(i=>i.category==="outros"),false);
});
test("mês sem contas não herda lançamentos nem créditos",()=>{
 const r=summarizeCategories(expenses,adjustments,"2027-06","crm");
 assert.equal(r.count,0);
 assert.equal(r.netCents,0);
 assert.equal(r.items.length,0);
});
