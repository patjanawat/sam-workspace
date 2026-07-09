import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBaseline, collapseLastPagePerSection, computeCurrent, computeSummaryFooter, computePageFooters, xraySummary,
} from '../lib/xray-summary.mjs';

// ---------------------------------------------------------------- baseline --

const prow = (productCode, rateType, page, rate) => ({ productCode, rateType, page, rate });

test('buildBaseline: max(RATE) per (page, product, rateType) → section keys; Discount separated', () => {
  const rows = [
    prow('P1', 'NR1', 1, 3), prow('P1', 'NR1', 1, 5),      // same cell → max 5
    prow('P1', 'SR1', 2, 7),
    prow('P1', 'Discount', 1, 4),
    prow('P1', 'SR4', 1, 99),                               // Amount types not in map → ignored
  ];
  const { baseline, discountByPage } = buildBaseline(rows);
  assert.equal(baseline[1].normalRebate.P1, 5);
  assert.equal(baseline[2].specialRebate.P1, 7);
  assert.equal(baseline[1].SR4, undefined);
  assert.equal(discountByPage[1].P1, 4);
});

test('collapse: last page wins per (section, product); gapped pages reindexed first', () => {
  // previous proposal pages {1,4} — gapped after a delete; reindex → {1,2}
  const rows = [
    prow('P1', 'NR1', 1, 3),
    prow('P1', 'NR1', 4, 23),   // last page for normalRebate
    prow('P1', 'FR1', 1, 9),    // only on page 1
    prow('P1', 'Discount', 1, 1), prow('P1', 'Discount', 4, 2),
  ];
  const { baseline, discountByPage } = buildBaseline(rows);
  const items = collapseLastPagePerSection(baseline, discountByPage);
  const get = (s) => items.find((x) => x.section === s)?.products.find((p) => p.productId === 'P1')?.value;
  assert.equal(get('normalRebate'), 23);      // page 4 (→2) wins
  assert.equal(get('freightRebate'), 9);      // falls back to its own last page (1)
  assert.equal(get('discountHeader'), 2);     // discount last page wins
});

// ----------------------------------------------------------------- current --

// build a stored RebatePayload JSON: pages[].payload double-encoded section array
const sec = (section, rows, meta) => ({ section, meta, rows });
const srow = (values, range = { from: 0, to: 9 }) => ({ range, values });
const val = (productId, oldV, newV) => ({ productId, old: oldV, new: newV });
const pageOf = (pageNumber, sections, extra = {}) =>
  ({ pageNumber, deleted: false, payload: JSON.stringify(sections), ...extra });
const wrapper = (pages) => JSON.stringify({ schemaVersion: 2, pages });

test('computeCurrent: per-section last countable page → max(new) per product', () => {
  const payload = wrapper([
    pageOf(1, [
      sec('normalRebate', [srow([val('P1', 3, 10)]), srow([val('P1', 3, 12)])]),
      sec('freightRebate', [srow([val('P1', 9, 9)])]),
    ]),
    pageOf(2, [
      sec('normalRebate', [srow([val('P1', 23, 33)])]),   // last page for normalRebate
      sec('freightRebate', []),                            // no countable row → page 1 stays last
    ]),
  ]);
  const { bySection, productIds } = computeCurrent(payload);
  assert.deepEqual(productIds, ['P1']);
  assert.equal(bySection.normalRebate.P1, 33);
  assert.equal(bySection.freightRebate.P1, 9);
});

test('computeCurrent: deleted pages skipped; discountHeader countable without range', () => {
  const payload = wrapper([
    pageOf(1, [sec('discountHeader', [srow([val('P1', 1, 5)], null)])]),
    pageOf(2, [sec('discountHeader', [srow([val('P1', 1, 7)], null)])], { deleted: true }),
  ]);
  const { bySection } = computeCurrent(payload);
  assert.equal(bySection.discountHeader.P1, 5);   // page 2 deleted → page 1 is last
});

test('computeCurrent: non-countable row (range null, not discountHeader) ignored', () => {
  const payload = wrapper([
    pageOf(1, [sec('normalRebate', [srow([val('P1', 0, 50)], null), srow([val('P1', 0, 8)])])]),
  ]);
  const { bySection } = computeCurrent(payload);
  assert.equal(bySection.normalRebate.P1, 8);     // 50 sits on a range-less row → not counted
});

// ------------------------------------------------------------------ footer --

test('computeSummaryFooter with previous: Latest = recomputed baseline, Changed = diff', () => {
  const payload = wrapper([
    pageOf(1, [
      sec('discountHeader', [srow([val('P1', 1, 1)], null)]),
      sec('normalRebate', [srow([val('P1', 3, 33)])]),
      sec('freightRebate', [srow([val('P1', 9, 29)])]),
    ]),
  ]);
  const prevRows = [
    prow('P1', 'NR1', 1, 3), prow('P1', 'FR1', 1, 9), prow('P1', 'Discount', 1, 1),
  ];
  const f = computeSummaryFooter({ payloadJson: payload, prevRows });
  const p1 = f.perProduct.find((p) => p.productId === 'P1');
  assert.equal(p1.current, 1 + 33 + 29);
  assert.equal(p1.latest, 1 + 3 + 9);
  assert.equal(p1.changed, 63 - 13);
  assert.equal(f.baselineUsed, 'recomputed');
});

test('computeSummaryFooter without previous: Latest falls back to max(old) per section', () => {
  const payload = wrapper([
    pageOf(1, [sec('normalRebate', [srow([val('P1', 3, 10)])])]),
  ]);
  const f = computeSummaryFooter({ payloadJson: payload, prevRows: null });
  assert.equal(f.perProduct[0].latest, 3);
  assert.equal(f.baselineUsed, 'fallback-old');
});

test('computeSummaryFooter: added pages excluded from the old-fallback', () => {
  const payload = wrapper([
    pageOf(1, [sec('normalRebate', [srow([val('P1', 3, 10)])])]),
    pageOf(2, [sec('normalRebate', [srow([val('P1', 99, 12)])])], { isAddedPage: true }),
  ]);
  const f = computeSummaryFooter({ payloadJson: payload, prevRows: null });
  assert.equal(f.perProduct[0].current, 12);   // current DOES include added pages
  assert.equal(f.perProduct[0].latest, 3);     // old-fallback skips added pages (SAM-1767)
});

// -------------------------------------------------------- this-page footer --

test('computePageFooters: current = max(new) across sections; latest = pmLastStep + discount old', () => {
  const payload = wrapper([
    pageOf(1, [
      sec('normalRebate', [srow([val('P1', 80, 120)])], { pmLastStep: [{ productId: 'P1', value: 50 }] }),
      sec('discountHeader', [srow([val('P1', 5, 10)], null)]),
    ]),
  ]);
  const [p1] = computePageFooters(payload);
  const row = p1.perProduct.find((x) => x.productId === 'P1');
  assert.equal(row.current, 120 + 10);
  assert.equal(row.latest, 50 + 5);
  assert.equal(row.changed, 130 - 55);
});

test('computePageFooters: per-page grain — page 2 does not inherit page 1\'s section values', () => {
  const payload = wrapper([
    pageOf(1, [sec('normalRebate', [srow([val('P1', 3, 100)])], { pmLastStep: [{ productId: 'P1', value: 3 }] })]),
    pageOf(2, [sec('freightRebate', [srow([val('P1', 1, 9)])], { pmLastStep: [{ productId: 'P1', value: 1 }] })]),
  ]);
  const [p1, p2] = computePageFooters(payload);
  assert.equal(p1.perProduct[0].current, 100);
  assert.equal(p2.perProduct[0].current, 9);   // not 109 — this page's own sections only
});

test('computePageFooters: added page forces latest = 0 even with copied old/pmLastStep values (SAM-1803)', () => {
  const payload = wrapper([
    pageOf(2, [
      sec('normalRebate', [srow([val('P1', 40, 100)])], { pmLastStep: [{ productId: 'P1', value: 40 }] }),
      sec('discountHeader', [srow([val('P1', 5, 10)], null)]),
    ], { isAddedPage: true }),
  ]);
  const [p2] = computePageFooters(payload);
  const row = p2.perProduct.find((x) => x.productId === 'P1');
  assert.equal(row.current, 110);
  assert.equal(row.latest, 0);
  assert.equal(row.changed, 110);
});

test('computePageFooters: deleted pages are dropped entirely', () => {
  const payload = wrapper([
    pageOf(1, [sec('normalRebate', [srow([val('P1', 1, 5)])])]),
    pageOf(2, [sec('normalRebate', [srow([val('P1', 1, 5)])])], { deleted: true }),
  ]);
  const pages = computePageFooters(payload);
  assert.deepEqual(pages.map((p) => p.pageNumber), [1]);
});

// ----------------------------------------------------------- orchestration --

const GUID = '11111111-1111-1111-1111-111111111111';
const PREV = '22222222-2222-2222-2222-222222222222';
const DB = { server: 'localhost', sam: { database: 'SamDb', user: 'sa', password: 'pw' } };

test('xraySummary wires header → payload → prev rows → footer', async () => {
  const payload = wrapper([pageOf(1, [sec('normalRebate', [srow([val('P1', 3, 33)])])])]);
  const readWide = async ({ sql }) => {
    if (/SELECT TOP 1/.test(sql)) return JSON.stringify({ id: GUID, groupId: 3, previousId: PREV, requestNo: 'REQ', version: 1 });
    if (/SELECT RebatePayload/.test(sql)) return payload;
    if (/ProposalProductTypeRS/.test(sql) && sql.includes(PREV)) return JSON.stringify([prow('P1', 'NR1', 1, 3)]);
    throw new Error('unexpected sql ' + sql.slice(0, 60));
  };
  const r = await xraySummary({ db: DB, proposalId: GUID, readWide });
  assert.equal(r.footer.perProduct[0].current, 33);
  assert.equal(r.footer.perProduct[0].latest, 3);
  assert.equal(r.footer.perProduct[0].changed, 30);
  assert.equal(r.footer.baselineUsed, 'recomputed');
  assert.ok(Array.isArray(r.sections));            // per-section breakdown for the UI
});

test('xraySummary guards: GUID + dev server', async () => {
  await assert.rejects(() => xraySummary({ db: DB, proposalId: 'x', readWide: async () => '' }), /GUID/i);
  await assert.rejects(() => xraySummary({ db: { ...DB, server: 'prod' }, proposalId: GUID, readWide: async () => '' }), /non-dev/i);
});
