import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPayload } from '../lib/build-payload.mjs';

test('type R injects product + dates, returns valid JSON string', async () => {
  const out = await buildPayload({ type: 'R', productIds: ['PRODX'], from: '2026-07-01', to: '2026-07-31' });
  const doc = JSON.parse(out.rebatePayload);
  assert.equal(doc.schemaVersion, 2);
  const val = doc.pages[0].payload[0].rows[0].values[0];
  assert.equal(val.productId, 'PRODX');
  assert.equal(doc.pages[0].payload[0].meta.from, '2026-07-01');
  assert.equal(out.specialPayload, undefined);
});

test('type S adds special + accum amount payloads', async () => {
  const out = await buildPayload({ type: 'S', productIds: ['PRODY'], from: '2026-07-01', to: '2026-07-31' });
  assert.ok(out.rebatePayload);
  const sp = JSON.parse(out.specialPayload);
  assert.equal(sp.sections[0].productIds[0], 'PRODY');
  assert.ok(out.accumPayload);
});

test('type P injects product into project payload object', async () => {
  const out = await buildPayload({ type: 'P', productIds: ['PRODZ'], from: '2026-07-01', to: '2026-07-31' });
  const doc = JSON.parse(out.rebatePayload);
  assert.equal(doc.pages[0].payload.products[0].productId, 'PRODZ');
  assert.equal(doc.pages[0].payload.validFrom, '2026-07-01');
});

test('throws if no productId given', async () => {
  await assert.rejects(() => buildPayload({ type: 'R', productIds: [], from: 'x', to: 'y' }), /productId/);
});
