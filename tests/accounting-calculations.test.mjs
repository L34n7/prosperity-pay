import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/accounting/calculations.ts", import.meta.url), "utf8");
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleObj = { exports: {} };
vm.runInNewContext(js, { module: moduleObj, exports: moduleObj.exports });
const { summarizeAccounting } = moduleObj.exports;
const banks = [
  { id: "inter", name: "Inter" },
  { id: "mp", name: "Mercado Pago" },
];
const boxes = [
  { id: "leandro", name: "Leandro" },
  { id: "crm", name: "CRM" },
];
let seq = 0;
function entry(kind, amount, bank, box, month = "2026-11-01", extra = {}) {
  return {
    id: String(++seq), title: kind, kind, amount_cents: amount, bank_id: bank, box_id: box,
    target_bank_id: null, target_box_id: null, origin_id: null, status: "paid",
    competence_month: month, created_at: "2026-11-05T10:00:00Z", ...extra,
  };
}
test("um banco conserva saldos distintos para dois caixas", () => {
  const ledger = [
    entry("opening",100000,"inter","leandro"),
    entry("opening",100000,"inter","crm"),
    entry("expense",30000,"inter","leandro"),
  ].filter(Boolean);
  ledger[2].competence_month = "2026-11-01";
  const view = summarizeAccounting("2026-11",banks,boxes,ledger);
  assert.equal(view.bankBalances.inter,170000);
  assert.equal(view.boxBalances.leandro,70000);
  assert.equal(view.boxBalances.crm,100000);
  assert.equal(view.matrix["inter:crm"],100000);
});
test("transferência entre caixas no mesmo banco não altera saldo bancário", () => {
  const view = summarizeAccounting("2026-11",banks,boxes,[
    entry("opening",100000,"inter","leandro"),
    entry("transfer",25000,"inter","leandro","2026-11-01",{
      target_bank_id:"inter",target_box_id:"crm",
    }),
  ]);
  assert.equal(view.bankBalances.inter,100000);
  assert.equal(view.boxBalances.leandro,75000);
  assert.equal(view.boxBalances.crm,25000);
  assert.equal(view.totals.transferred,25000);
});
test("transferência entre bancos transfere o saldo sem criar receitas", () => {
  const view = summarizeAccounting("2026-11",banks,boxes,[
    entry("opening",100000,"inter","leandro"),
    entry("transfer",40000,"inter","leandro","2026-11-01",{
      target_bank_id:"mp",target_box_id:"crm",
    }),
  ]);
  assert.equal(view.bankBalances.inter,60000);
  assert.equal(view.bankBalances.mp,40000);
  assert.equal(view.totals.balance,100000);
  assert.equal(view.totals.received,0);
});
test("conta pendente não reduz saldo, mas aumenta contas a pagar", () => {
  const view = summarizeAccounting("2026-11",banks,boxes,[
    entry("opening",100000,"inter","leandro"),
    entry("expense",35000,"inter","leandro","2026-11-01",{status:"pending"}),
  ]);
  assert.equal(view.totals.balance,100000);
  assert.equal(view.totals.pending,35000);
  assert.equal(view.totals.paid,0);
});
test("fechamento mensal carrega saldos anteriores sem duplicar receita", () => {
  const view = summarizeAccounting("2026-11",banks,boxes,[
    entry("opening",100000,"inter","leandro","2026-10-01"),
    entry("income",20000,"inter","leandro"),
    entry("expense",15000,"inter","leandro"),
  ]);
  assert.equal(view.totals.initialBalance,100000);
  assert.equal(view.totals.balance,105000);
  assert.equal(view.totals.received,20000);
  assert.equal(view.totals.paid,15000);
});
