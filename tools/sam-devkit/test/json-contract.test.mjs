import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upsertContractByProductId, upsertContractForAllProducts } from '../lib/json-contract.mjs';

// flat page-payload (still accepted for robustness)
const sample = () => ({
  validFrom: '20260101', validTo: '20260131',
  products: [{ colId: 'col-1', productId: 'P100' }, { colId: 'col-2', productId: 'P200' }],
  values: { contract: { 'col-1': { old: null, new: '' } } },
});

// real stored shape: DiscountDocumentTypeP with a DOUBLE-ENCODED (string) page payload
const docWithStringPayload = () => ({
  schemaVersion: 2, currentPage: 1, totalPages: 1, maxPages: 10,
  pages: [{
    pageNumber: 1, deleted: false, disabled: true,
    payload: JSON.stringify({
      validFrom: '2026-07-01', validTo: '2026-07-31',
      products: [{ colId: 'col-1', productId: '100048' }],
      values: { contract: { 'col-1': { new: '', value: '', disabled: true } } },
    }),
  }],
});

test('upsertContractForAllProducts handles double-encoded (string) page payload', () => {
  const doc = docWithStringPayload();
  assert.equal(upsertContractForAllProducts(doc, '55740713894'), 1); // one product on the (disabled, non-deleted) page
  // page.payload is written back as a STRING (still double-encoded)
  assert.equal(typeof doc.pages[0].payload, 'string');
  const pp = JSON.parse(doc.pages[0].payload);
  assert.equal(pp.values.contract['col-1'].new, '55740713894');
  assert.equal(pp.values.contract['col-1'].disabled, true); // other cell fields preserved
});

test('upsertContractByProductId targets the right product in a string page payload', () => {
  const doc = docWithStringPayload();
  assert.equal(upsertContractByProductId(doc, '100048', 'C-7'), true);
  assert.equal(JSON.parse(doc.pages[0].payload).values.contract['col-1'].new, 'C-7');
  const doc2 = docWithStringPayload();
  assert.equal(upsertContractByProductId(doc2, 'NOPE', 'C-7'), false);
});

test('deleted pages are skipped', () => {
  const doc = docWithStringPayload();
  doc.pages[0].deleted = true;
  assert.equal(upsertContractForAllProducts(doc, 'C-1'), 0);
});

test('upsertContractByProductId sets values.contract[col-N].new', () => {
  const p = sample();
  assert.equal(upsertContractByProductId(p, 'P200', 'C-9'), true);
  assert.equal(p.values.contract['col-2'].new, 'C-9');
});

test('upsertContractByProductId creates missing values/contract/cell', () => {
  const p = { products: [{ colId: 'col-1', productId: 'P100' }] }; // no values at all
  assert.equal(upsertContractByProductId(p, 'P100', 'C-1'), true);
  assert.equal(p.values.contract['col-1'].new, 'C-1');
});

test('upsertContractByProductId returns false for unknown product (no mutation)', () => {
  const p = sample();
  const before = JSON.stringify(p);
  assert.equal(upsertContractByProductId(p, 'ZZZ', 'C-1'), false);
  assert.equal(JSON.stringify(p), before);
});

test('upsertContractForAllProducts sets every product and returns count', () => {
  const p = sample();
  assert.equal(upsertContractForAllProducts(p, 'C-ALL'), 2);
  assert.equal(p.values.contract['col-1'].new, 'C-ALL');
  assert.equal(p.values.contract['col-2'].new, 'C-ALL');
});

test('upsertContractForAllProducts returns 0 when no products', () => {
  assert.equal(upsertContractForAllProducts({ products: [] }, 'C'), 0);
});
