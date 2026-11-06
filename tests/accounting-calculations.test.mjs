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
vm.runInNewContext(js, {
  module: moduleObj, exports: moduleObj.exports,
  require: (name) => {
    if (name === "./cash-flow") return { groupCardInvoices: () => [], brazilDate: (value) => value.slice(0, 10) };
    throw new Error("Unexpected require: " + name);
  },
});
const { summarizeAccounting, summarizeBoxAccounts } = moduleObj.exports;
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

test("Pix de saída avulsa diminui saldo sem ser conta a pagar ou despesa paga", () => {
  const view = summarizeAccounting("2026-11",banks,boxes,[
    entry("opening",100000,"inter","crm","2026-10-01"),
    entry("outflow",1100,"inter","crm"),
    entry("expense",35000,"inter","crm","2026-11-01",{status:"pending"}),
  ]);
  assert.equal(view.bankBalances.inter,98900);
  assert.equal(view.boxBalances.crm,98900);
  assert.equal(view.totals.outflow,1100);
  assert.equal(view.totals.paid,0);
  assert.equal(view.totals.pending,35000);
  assert.equal(view.monthEntries.filter(e=>e.kind==="expense").length,1);
});
test("saídas avulsas históricas são transportadas e não duplicadas no mês seguinte", () => {
  const ledger = [
    entry("opening",100000,"inter","crm","2026-10-01"),
    entry("outflow",1100,"inter","crm","2026-11-01"),
  ];
  const view = summarizeAccounting("2026-12",banks,boxes,ledger);
  assert.equal(view.totals.initialBalance,98900);
  assert.equal(view.totals.balance,98900);
  assert.equal(view.totals.outflow,0);
});

test("contas por caixa somam valor líquido, total, pago e pendente sem misturar saldos", () => {
  const current = [
    entry("opening", 100000, "inter", "crm", "2026-10-01"),
    entry("outflow", 1000, "inter", "crm"),
    entry("income", 2000, "inter", "crm"),
    entry("expense", 15000, "inter", "crm", "2026-11-01", { status: "pending" }),
    entry("expense", 5000, "inter", "leandro"),
    entry("expense", 2200, "inter", "leandro", "2026-12-01", { status: "pending" }),
  ];
  const invoices = [{
    invoice_month: "2026-11-01", box_id: "leandro", card_id:"card1",
    charges: 3, total_cents: 45000, adjustment_cents: -5000,
    paid_cents: 10000, remaining_cents: 30000,
  },{
    invoice_month: "2026-12-01", box_id: "crm",card_id:"card2",
    charges: 8, total_cents: 80000, adjustment_cents: 0,
    paid_cents: 0, remaining_cents: 80000,
  }];
  const data = summarizeBoxAccounts("2026-11", boxes, current, invoices);
  assert.equal(data.crm.count, 1);
  assert.equal(data.crm.grossCents, 15000);
  assert.equal(data.crm.totalCents, 15000);
  assert.equal(data.crm.pendingCents, 15000);
  assert.equal(data.crm.paidCents, 0);
  assert.equal(data.leandro.count, 4);
  assert.equal(data.leandro.cardCount, 3);
  assert.equal(data.leandro.grossCents, 50000);
  assert.equal(data.leandro.adjustmentCents, -5000);
  assert.equal(data.leandro.totalCents, 45000);
  assert.equal(data.leandro.paidCents, 15000);
  assert.equal(data.leandro.pendingCents, 30000);
  assert.equal(data.leandro.paidCents + data.leandro.pendingCents,data.leandro.totalCents);
});
test("resumo mensal do caixa não inclui Pix nem transferências entre os responsáveis", () => {
  const view = summarizeAccounting("2026-11",banks,boxes,[
    entry("opening", 50000, "inter", "crm", "2026-10-01"),
    entry("outflow", 12000, "inter", "crm"),
    entry("transfer", 5000, "inter", "crm", "2026-11-01",{
      target_bank_id:"inter",target_box_id:"leandro",
    }),
    entry("expense", 7500, "inter", "crm", "2026-11-01",{status:"pending"}),
  ]);
  assert.equal(view.boxAccounts.crm.count, 1);
  assert.equal(view.boxAccounts.crm.totalCents, 7500);
  assert.equal(view.boxAccounts.crm.pendingCents, 7500);
  assert.equal(view.boxAccounts.leandro.count, 0);
  assert.equal(view.boxAccounts.leandro.totalCents, 0);
  assert.equal(view.boxBalances.crm, 33000);
});
