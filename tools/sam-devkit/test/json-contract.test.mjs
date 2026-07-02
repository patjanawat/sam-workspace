import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colIndexByProductId, upsertContractByProductId, upsertContractForAllProducts } from '../lib/json-contract.mjs';

const sample = () => ({
  validFrom: '20260101', validTo: '20260131',
  products: [{ colId: 'col-1', productId: 'P100' }, { colId: 'col-2', productId: 'P200' }],
  values: { contract: { 'col-1': { old: null, new: '' } } },
});

test('colIndexByProductId returns 1-based position, -1 if missing', () => {
  const p = sample();
  assert.equal(colIndexByProductId(p, 'P100'), 1);
  assert.equal(colIndexByProductId(p, 'P200'), 2);
  assert.equal(colIndexByProductId(p, 'NOPE'), -1);
  assert.equal(colIndexByProductId(p, ' P200 '.trim()), 2);
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
