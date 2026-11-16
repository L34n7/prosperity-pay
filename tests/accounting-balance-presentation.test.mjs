import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/accounting/balance-presentation.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleObj = { exports: {} };
vm.runInNewContext(js, { module: moduleObj, exports: moduleObj.exports });
const { summarizeBankAllocations } = moduleObj.exports;
const banks = [{id:"inter",name:"Inter"},{id:"mp",name:"Mercado Pago"}];
const boxes = [{id:"leandro",name:"Leandro"},{id:"crm",name:"CRM"}];

test("saldo líquido de Leandro informa Inter positivo, Mercado Pago deficitário e diferença",()=>{
 const result=summarizeBankAllocations(banks,boxes,{
  "inter:leandro":93113,"mp:leandro":-78639,
  "inter:crm":-103965,"mp:crm":259221,
 });
 const leandro=result.find(item=>item.boxId==="leandro");
 assert.equal(leandro.positiveCents,93113);
 assert.equal(leandro.deficitCents,78639);
 assert.equal(leandro.netCents,14474);
 assert.equal(leandro.hasCrossBankDeficit,true);
 assert.equal(leandro.banks[0].bankName,"Inter");
 assert.equal(leandro.banks[1].bankName,"Mercado Pago");
 assert.equal(result.find(item=>item.boxId==="crm").netCents,155256);
});
test("saldo integralmente em um banco não exige aviso de conciliação",()=>{
 const [only]=summarizeBankAllocations(banks,[boxes[0]],{
   "inter:leandro":45000,
 });
 assert.equal(only.netCents,45000);
 assert.equal(only.deficitCents,0);
 assert.equal(only.hasCrossBankDeficit,false);
 assert.equal(only.banks.length,1);
});
test("caixa exclusivamente negativo não é exibido como dinheiro disponível",()=>{
 const [only]=summarizeBankAllocations(banks,[boxes[0]],{"mp:leandro":-12500});
 assert.equal(only.netCents,-12500);
 assert.equal(only.positiveCents,0);
 assert.equal(only.deficitCents,12500);
 assert.equal(only.hasCrossBankDeficit,false);
});
