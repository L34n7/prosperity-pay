import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/accounting/installments.ts",import.meta.url),"utf8");
const output = ts.transpileModule(source,{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;
const m = {exports:{}};
vm.runInNewContext(output,{module:m,exports:m.exports,Date,Array,Error});
const {buildInstallmentSchedule,shiftMonthlyDate} = m.exports;

test("2/5 novembro termina em fevereiro do ano seguinte",()=>{
  assert.deepEqual(JSON.parse(JSON.stringify(buildInstallmentSchedule("2026-11-05",2,5))),[
    {number:2,dueOn:"2026-11-05"},
    {number:3,dueOn:"2026-12-05"},
    {number:4,dueOn:"2027-01-05"},
    {number:5,dueOn:"2027-02-05"},
  ]);
});
test("primeira parcela fora da série não é criada retroativamente",()=>{
  assert.equal(buildInstallmentSchedule("2026-11-05",5,5).length,1);
});
test("vencimento dia 31 se ajusta no fevereiro mas volta ao dia original em março",()=>{
  assert.equal(shiftMonthlyDate("2027-01-31",1),"2027-02-28");
  assert.equal(shiftMonthlyDate("2027-01-31",2),"2027-03-31");
  assert.equal(shiftMonthlyDate("2028-01-31",1),"2028-02-29");
});
test("valida números e datas de parcelas",()=>{
  assert.throws(()=>buildInstallmentSchedule("2026-11-05",6,5));
  assert.throws(()=>buildInstallmentSchedule("2026-11-05",0,5));
  assert.throws(()=>buildInstallmentSchedule("2026-11-05",1,121));
  assert.throws(()=>shiftMonthlyDate("2027-02-31",0));
});
