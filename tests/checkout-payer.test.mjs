import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise actual service code with external I/O replaced, without creating payments.
function loadSource(path, dependencies = {}, fetchMock) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(compiled, {
    module: loadedModule, exports: loadedModule.exports,
    require: name => dependencies[name] ?? {},
    fetch: fetchMock,
    console: { error() {}, warn() {}, info() {} },
  });
  return loadedModule.exports;
}
const validation = loadSource('src/lib/checkout/buyer-validation.ts');
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const dependencies = {
  '@/lib/api/http': { HttpError },
  '@/lib/checkout/buyer-validation': validation,
  '@/lib/supabase/admin': { createAdminClient() { throw new Error('Unexpected database access'); } },
};

test('reject incident emails and accept real payer domains', () => {
  for (const email of ['22awda@22awda', 'leandro123@leandro123', 'a..b@example.com', 'a@-bad.com', 'a b@example.com']) {
    assert.equal(validation.isValidBuyerEmail(email), false, email);
  }
  for (const email of ['mariabb.12@outlook.com', 'lucasisi10@gmail.com', ' name+tag@example.com.br ']) {
    assert.equal(validation.isValidBuyerEmail(email), true, email);
  }
});

test('validate CPF check digits, formatting and optional automated PIX CPF', () => {
  assert.equal(validation.isValidBuyerCpf('529.982.247-25'), true);
  for (const cpf of ['52998224726', '11111111111', '00000000000', '123']) {
    assert.equal(validation.isValidBuyerCpf(cpf), false, cpf);
  }
  assert.equal(validation.buyerValidationError('buyer@example.com'), '');
});

test('invalid payer stops before database writes in initial and renewal checkout', async () => {
  const initial = loadSource('src/lib/checkout/transparent-checkout-service.ts', dependencies);
  const renewal = loadSource('src/lib/checkout/subscription-session-checkout.ts', dependencies);
  for (const create of [initial.createTransparentCheckout, renewal.createSubscriptionSessionCheckout]) {
    await assert.rejects(create({ customerEmail: '22awda@22awda', customerDocument: '52998224725', paymentMethod: 'pix' }),
      error => error.status === 400 && error.message.includes('e-mail válido'));
    await assert.rejects(create({ customerEmail: 'buyer@example.com', customerDocument: '11111111111', paymentMethod: 'pix' }),
      error => error.status === 400 && error.message.includes('CPF inválido'));
  }
});

test('provider field error is translated while raw detail and idempotency survive', async () => {
  const body = { errors: [{ code: 'property_value', message: 'Invalid value for property', details: ["'$.payer.email' - does not match pattern"] }] };
  const service = loadSource('src/lib/checkout/transparent-checkout-service.ts', dependencies, async (url, init) => {
    assert.equal(url, 'https://api.mercadopago.com/v1/orders');
    assert.equal(init.headers['X-Idempotency-Key'], 'attempt-1');
    return { ok: false, status: 400, async json() { return body; } };
  });
  await assert.rejects(service.mpRequest('test-token', '/v1/orders', { method: 'POST' }, 'attempt-1'),
    error => error.status === 422 && error.providerBody === body && error.message.includes('e-mail válido'));
});

test('HTTP 402 keeps failed Order for linkage and does not claim payment success', async () => {
  const body = { id: 'ORD-test', transactions: { payments: [{ id: 'PAY-test', status: 'failed', status_detail: 'processing_error' }] } };
  const service = loadSource('src/lib/checkout/transparent-checkout-service.ts', dependencies,
    async () => ({ ok: false, status: 402, async json() { return body; } }));
  await assert.rejects(service.mpRequest('test-token', '/v1/orders'),
    error => error.providerStatus === 402 && error.providerBody.id === 'ORD-test' && error.message.includes('não conseguiu processar este PIX'));
});
