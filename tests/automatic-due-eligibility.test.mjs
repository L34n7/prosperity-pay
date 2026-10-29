import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(
  new URL("../src/lib/subscriptions/automatic-due-eligibility.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleObj = { exports: {} };
vm.runInNewContext(compiled, {
  module: moduleObj,
  exports: moduleObj.exports,
  require: () => ({ PREPAID_GRACE_PERIOD_DAYS: 7 }),
});
const { isEligibleForAutomaticDueBilling: canCharge } = moduleObj.exports;
const dueAt = "2026-10-01T12:00:00.000Z";
const due = Date.parse(dueAt);
const day = 86_400_000;
const subscription = (status, end = dueAt) => ({
  id: "test-sub",
  status,
  billing_model: "prepaid",
  current_period_end: end,
});

test("assinatura ativa e vencida permitem somente a cobrança do ciclo atual", () => {
  assert.equal(canCharge(subscription("active"), dueAt, due), true);
  assert.equal(canCharge(subscription("past_due"), dueAt, due + 6 * day), true);
  assert.equal(canCharge(subscription("past_due"), dueAt, due + 7 * day - 1), true);
});

test("bloqueadas, canceladas e outros status não geram novos pagamentos", () => {
  for (const status of ["paused", "cancelled", "pending", "blocked", "failed"]) {
    assert.equal(canCharge(subscription(status), dueAt, due + day), false, status);
  }
});

test("após sete dias de inadimplência não cria cobrança nem mesmo se status estiver atrasado", () => {
  assert.equal(canCharge(subscription("past_due"), dueAt, due + 7 * day), false);
  assert.equal(canCharge(subscription("active"), dueAt, due + 12 * day), false);
});

test("nunca cobra ciclo antigo após renovação ou antes do vencimento", () => {
  assert.equal(canCharge(subscription("active"), dueAt, due - 1), false);
  assert.equal(canCharge(subscription("active", "2026-11-01T12:00:00.000Z"), dueAt, due + day), false);
});

test("não gera cobranças de assinatura não pré-paga ou com datas inválidas", () => {
  assert.equal(canCharge({...subscription("active"), billing_model:"postpaid"}, dueAt, due), false);
  assert.equal(canCharge(subscription("active", "invalid"), dueAt, due), false);
  assert.equal(canCharge(subscription("active"), "invalid", due), false);
});
