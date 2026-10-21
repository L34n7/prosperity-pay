import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function loadModule() {
  const source = readFileSync(
    new URL("../src/lib/subscriptions/existing-subscription-checkout.ts", import.meta.url),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  const loadedModule = { exports: {} };
  vm.runInNewContext(compiled, {
    module: loadedModule,
    exports: loadedModule.exports,
    require: () => ({}),
    console: { error() {}, warn() {}, info() {} },
  });
  return loadedModule.exports;
}

const resolver = loadModule();

test("prioritize CRM-linked migrated subscription over newer duplicate", () => {
  const canonical = resolver.chooseCanonicalSubscription([
    {
      id: "duplicate-active",
      status: "active",
      offer_id: "offer-vip",
      current_period_end: "2026-11-21T13:53:03.469Z",
      external_reference: null,
      metadata: {},
      created_at: "2026-10-21T13:53:03.469Z",
    },
    {
      id: "migrated-canonical",
      status: "past_due",
      offer_id: "offer-vip",
      current_period_end: "2026-10-21T11:58:10.000Z",
      external_reference: "crm_prosperity:company-123",
      metadata: { imported: true },
      created_at: "2026-09-20T10:00:00.000Z",
    },
  ]);

  assert.equal(canonical.id, "migrated-canonical");
});

test("same recurring offer becomes renewal", () => {
  assert.equal(
    resolver.resolveExistingSubscriptionAction({
      subscriptionOfferId: "offer-basic",
      targetOfferId: "offer-basic",
    }),
    "renew",
  );
});

test("different plan never creates a second subscription from public checkout", () => {
  assert.equal(
    resolver.resolveExistingSubscriptionAction({
      subscriptionOfferId: "offer-basic",
      targetOfferId: "offer-essential",
    }),
    "plan_change_required",
  );
});
