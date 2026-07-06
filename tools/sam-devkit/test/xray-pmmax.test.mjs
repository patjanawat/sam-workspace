import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computePmMaxRows, xrayPmMax } from '../lib/xray-pmmax.mjs';

const prow = (productCode, rateType, page, rate) => ({ productCode, rateType, page, rate });
const sec = (section, meta, rows = [{ range: { from: 0, to: 9 }, values: [] }]) => ({ section, meta, rows });
const pageOf = (pageNumber, sections, extra = {}) =>
  ({ pageNumber, deleted: false, payload: JSON.stringify(sections), ...extra });
const wrapper = (pages) => JSON.stringify({ schemaVersion: 2, pages });
const pm = (productId, value) => ({ productId, value });

const findRow = (rows, page, section, pid) =>
  rows.find((r) => r.page === page && r.section === section && r.productId === pid);

test('expected = baseline of the SAME (reindexed) page; stored-vs-expected match flagged', () => {
  const payload = wrapper([
    pageOf(1, [sec('normalRebate', { pmLastStep: [pm('P1', 3)] })]),
    pageOf(2, [sec('normalRebate', { pmLastStep: [pm('P1', 30)] })]),   // stale — expected 23
  ]);
  const prevRows = [prow('P1', 'NR1', 1, 3), prow('P1', 'NR1', 4, 23)]; // gapped {1,4} → reindex {1,2}
  const rows = computePmMaxRows({ payloadJson: payload, prevRows });
  assert.equal(findRow(rows, 1, 'normalRebate', 'P1').expected, 3);
  assert.equal(findRow(rows, 1, 'normalRebate', 'P1').match, true);
  const r2 = findRow(rows, 2, 'normalRebate', 'P1');
  assert.equal(r2.expected, 23);          // gapped page 4 reindexed to 2
  assert.equal(r2.stored, 30);
  assert.equal(r2.match, false);          // SAM-1810-style stale meta caught
});

test('added page expects page-1 baseline', () => {
  const payload = wrapper([
    pageOf(1, [sec('normalRebate', { pmLastStep: [pm('P1', 3)] })]),
    pageOf(2, [sec('normalRebate', { pmLastStep: [pm('P1', 3)] })], { isAddedPage: true }),
  ]);
  const rows = computePmMaxRows({ payloadJson: payload, prevRows: [prow('P1', 'NR1', 1, 3), prow('P1', 'NR1', 2, 20)] });
  const r2 = findRow(rows, 2, 'normalRebate', 'P1');
  assert.equal(r2.expected, 3);           // page-1 fallback, NOT page 2's 20
  assert.equal(r2.addedPage, true);
});

test('page with no previous counterpart treated as added (page-1 fallback)', () => {
  const payload = wrapper([
    pageOf(1, [sec('normalRebate', { pmLastStep: [pm('P1', 3)] })]),
    pageOf(3, [sec('normalRebate', { pmLastStep: [pm('P1', 3)] })]),
  ]);
  const rows = computePmMaxRows({ payloadJson: payload, prevRows: [prow('P1', 'NR1', 1, 3)] });
  assert.equal(findRow(rows, 3, 'normalRebate', 'P1').expected, 3);
  assert.equal(findRow(rows, 3, 'normalRebate', 'P1').addedPage, true);
});

test('no previous rows → expected null, reported not comparable', () => {
  const payload = wrapper([pageOf(1, [sec('normalRebate', { pmLastStep: [pm('P1', 3)] })])]);
  const rows = computePmMaxRows({ payloadJson: payload, prevRows: [] });
  assert.equal(rows[0].expected, null);
  assert.equal(rows[0].match, null);
});

test('stored missing but baseline has product → surfaced with stored null (meta stripped)', () => {
  const payload = wrapper([pageOf(1, [sec('normalRebate', undefined)])]);
  const rows = computePmMaxRows({ payloadJson: payload, prevRows: [prow('P1', 'NR1', 1, 7)] });
  const r = findRow(rows, 1, 'normalRebate', 'P1');
  assert.equal(r.stored, null);
  assert.equal(r.expected, 7);
  assert.equal(r.match, false);
});

test('xrayPmMax orchestration wires header → payload → prev rows', async () => {
  const GUID = '11111111-1111-1111-1111-111111111111';
  const PREV = '22222222-2222-2222-2222-222222222222';
  const payload = wrapper([pageOf(1, [sec('normalRebate', { pmLastStep: [pm('P1', 3)] })])]);
  const readWide = async ({ sql }) => {
    if (/SELECT TOP 1/.test(sql)) return JSON.stringify({ id: GUID, previousId: PREV, requestNo: 'REQ', version: 1 });
    if (/SELECT RebatePayload/.test(sql)) return payload;
    if (/ProposalProductTypeRS/.test(sql)) return JSON.stringify([prow('P1', 'NR1', 1, 3)]);
    throw new Error('unexpected sql');
  };
  const r = await xrayPmMax({ db: { server: 'localhost', sam: {} }, proposalId: GUID, readWide });
  assert.equal(r.rows[0].match, true);
  assert.equal(r.summary.mismatches, 0);
  await assert.rejects(() => xrayPmMax({ db: { server: 'prod' }, proposalId: GUID, readWide }), /non-dev/i);
});
