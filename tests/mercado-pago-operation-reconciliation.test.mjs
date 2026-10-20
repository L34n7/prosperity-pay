import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function loadModule() {
  const source = readFileSync(
    new URL("../src/lib/payments/mercado-pago-operation-reconciliation.ts", import.meta.url),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(compiled, {
    module: loadedModule,
    exports: loadedModule.exports,
    require: () => ({}),
    fetch: async () => {
      throw new Error("Unexpected network access");
    },
    console: { error() {}, warn() {}, info() {} },
  });
  return loadedModule.exports;
}

const reconciliation = loadModule();

test("extract Mercado Pago SOURCE_ID by external reference", () => {
  const csv = [
    "EXTERNAL_REFERENCE;SOURCE_ID;TRANSACTION_TYPE;TRANSACTION_DATE",
    "prosperity-f1875a96-7745-4006-bb6b-8e41940219a2;B33FDJGVGD5PZXRAM;SETTLEMENT;2026-10-15T23:56:20Z",
  ].join("\n");

  assert.equal(
    reconciliation.operationIdByExternalReference(csv).get(
      "prosperity-f1875a96-7745-4006-bb6b-8e41940219a2",
    ),
    "B33FDJGVGD5PZXRAM",
  );
});

test("prefer settlement SOURCE_ID over refund row for the same reference", () => {
  const csv = [
    "EXTERNAL_REFERENCE;SOURCE_ID;TRANSACTION_TYPE",
    "prosperity-x;REF-ABC;REFUND",
    "prosperity-x;B33FDJGVGD5PZXRAM;SETTLEMENT",
  ].join("\n");

  assert.equal(
    reconciliation.operationIdByExternalReference(csv).get("prosperity-x"),
    "B33FDJGVGD5PZXRAM",
  );
});

test("parse both comma and semicolon Mercado Pago CSV formats", () => {
  assert.equal(
    reconciliation.parseCsv('SOURCE_ID,EXTERNAL_REFERENCE\n"B33,ABC","prosperity-x"\n')[0]
      .source_id,
    "B33,ABC",
  );
  assert.equal(
    reconciliation.parseCsv("SOURCE_ID;EXTERNAL_REFERENCE\nB33ABC;prosperity-x\n")[0]
      .external_reference,
    "prosperity-x",
  );
});

test("use a closed UTC hour accepted by settlement_report", () => {
  const range = reconciliation.reportRangeForPayment(
    "2026-10-15T23:56:20.506Z",
  );
  assert.equal(range.key, "2026-10-15T23:00:00.000Z|2026-10-15T23:59:59.999Z");
  assert.equal(range.gte, "2026-10-15T23:00:00.000Z");
  assert.equal(range.lte, "2026-10-15T23:59:59.999Z");
});

test("read reconciled transaction number from raw provider metadata", () => {
  assert.equal(
    reconciliation.mercadoPagoOperationId({
      prosperity_ml_operation_reconciliation: {
        source: "mercadopago_settlement_report",
        operation_id: "B33FDJGVGD5PZXRAM",
      },
    }),
    "B33FDJGVGD5PZXRAM",
  );
});
