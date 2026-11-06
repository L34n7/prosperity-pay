import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source=readFileSync(new URL("../src/lib/accounting/movements.ts",import.meta.url),"utf8");
const js=ts.transpileModule(source,{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText;
const module={exports:{}};
vm.runInNewContext(js,{
  module,exports:module.exports,Map,Date,Intl,Number,Array,Object,Error,
  require: (name)=>{
    if(name==="./cash-flow")return {
      brazilDate:(instant)=>instant.slice(0,10),
    };
    throw new Error("Unexpected dependency: "+name);
  }
});
const {collectBankMovements,filterBankMovements,movementSignedAmount,sumMovements,
  shiftReportDay,reportMonthBounds}=module.exports;
const timestamp="2026-10-02T12:00:00-03:00";
function entry(id,kind,amount,bank="Inter",box="CRM",rest={}){
  return {id,kind,status:"paid",title:id,amount_cents:amount,
    bank_id:bank,box_id:box,target_bank_id:null,target_box_id:null,
    card_id:null,settled_on:"2026-10-02",movement_at:timestamp,notes:"",
    ...rest};
}
const data=[
  entry("opening","opening",100000),
  entry("part-leandro","income",8334,"Inter","Leandro"),
  entry("ministry","income",45000,"Inter","Leandro"),
  entry("outflow","outflow",1100),
  entry("transfer","transfer",25000,"Inter","CRM",{target_bank_id:"MP",target_box_id:"CRM"}),
  entry("bill","expense",3000),
  entry("pending-bill","expense",5000,"Inter","CRM",{status:"pending",movement_at:null,settled_on:null}),
  entry("card","expense",7000,"Inter","CRM",{status:"pending",card_id:"card-x",movement_at:null,settled_on:null}),
];
const cardPayments=[{id:"p1",card_id:"card-x",paid_at:"2026-10-05T09:30:00-03:00",
  bank_id:"Inter",box_id:"Leandro",amount_cents:9000}];
const receipts=[{id:"r1",status:"received",title:"Cliente",
  bank_id:"MP",box_id:"CRM",amount_cents:3000,received_at:"2026-10-06T10:00:00-03:00"},
 {id:"r2",status:"expected",title:"Previsto",bank_id:"MP",
  box_id:"CRM",amount_cents:200000,received_at:null}];
const cards=[{id:"card-x",name:"Cartão Inter"}];
const rows=collectBankMovements(data,cardPayments,receipts,cards);
test("o extrato inclui todas as movimentacoes confirmadas e ignora compras e previsoes",()=>{
  assert.equal(rows.length,8);
  assert.ok(rows.some(x=>x.kind==="outflow"&&x.amount_cents===1100));
  assert.ok(rows.some(x=>x.kind==="bill_payment"&&x.amount_cents===3000));
  assert.ok(rows.some(x=>x.kind==="card_payment"&&x.amount_cents===9000));
  assert.equal(rows.some(x=>x.title==="card"||x.title==="pending-bill"||x.title==="Previsto"),false);
});
test("filtros de entradas e transferencias nao exibem saidas",()=>{
  const byIncome=filterBankMovements(rows,{start:"2026-10-01",end:"2026-10-31",kind:"income",bankId:"",boxId:"",search:""});
  assert.equal(byIncome.length,3);
  const byTransfer=filterBankMovements(rows,{start:"2026-10-01",end:"2026-10-31",kind:"transfer",bankId:"",boxId:"",search:""});
  assert.equal(byTransfer.length,1);
});
test("movimentacoes de Jefferson e Ministerio ficam no caixa Leandro",()=>{
  const filter={start:"2026-10-01",end:"2026-10-31",kind:"income",bankId:"Inter",boxId:"Leandro",search:""};
  const result=filterBankMovements(rows,filter);
  assert.equal(result.length,2);
  assert.equal(sumMovements(result,"Inter","Leandro").inCents,53334);
});
test("transferencia nao duplica dinheiro no total e possui sinais por banco",()=>{
  const move=rows.find(x=>x.kind==="transfer");
  assert.equal(movementSignedAmount(move),0);
  assert.equal(movementSignedAmount(move,"Inter"),-25000);
  assert.equal(movementSignedAmount(move,"MP"),25000);
  assert.equal(movementSignedAmount(move,"Inter","CRM"),-25000);
  assert.equal(movementSignedAmount(move,"MP","CRM"),25000);
});
test("filtro banco e caixa precisa corresponder ao mesmo lado da transferencia",()=>{
  const transfer=entry("mix","transfer",5000,"Inter","Leandro",{
    target_bank_id:"MP",target_box_id:"Lucas"
  });
  const moves=collectBankMovements([transfer],[],[],[]);
  const basic={start:"2026-10-01",end:"2026-10-31",kind:"all",search:""};
  assert.equal(filterBankMovements(moves,{...basic,bankId:"Inter",boxId:"Lucas"}).length,0);
  assert.equal(filterBankMovements(moves,{...basic,bankId:"MP",boxId:"Lucas"}).length,1);
});
test("periodo com ultimo dia do mes inclui registros do dia 31",()=>{
  assert.equal(reportMonthBounds("2026-10").end,"2026-10-31");
  assert.equal(reportMonthBounds("2027-02").end,"2027-02-28");
  assert.equal(shiftReportDay("2026-11-06",-59),"2026-09-08");
});
