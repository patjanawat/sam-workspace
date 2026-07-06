import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmt, fmt1, computeRowsRS, computeRowsP, buildDto, compareWithApi, xrayOverview, FIELD_MAP } from '../lib/xray-overview.mjs';

// ------------------------------------------------------------------ fmt ----

test('fmt mirrors BE "#,##0" (int, comma groups)', () => {
  assert.equal(fmt(0), '0');
  assert.equal(fmt(1100), '1,100');
  assert.equal(fmt(-50), '-50');
  assert.equal(fmt(1234567), '1,234,567');
});

test('fmt1 mirrors BE "#,##0.0"', () => {
  assert.equal(fmt1(11), '11.0');
  assert.equal(fmt1(8.75), '8.8');   // banker-free round-half-up like .NET ToString
  assert.equal(fmt1(1234.56), '1,234.6');
});

// ------------------------------------------------------- Type R/S engine ---

// raw ProposalProductTypeRS rows
const rs = (productCode, rateType, page, rate, over = {}) => ({
  productCode, productName: 'Prod ' + productCode, rateType, page, rate,
  priceList: 100, subsidy: 10, varCost: 60, ...over,
});

const CUR_R = [
  // Discount: pages 1..2 → last page 2 → rows 5.2, 5.0 → int-cast per row → max = 5
  rs('A', 'Discount', 1, 4.9), rs('A', 'Discount', 2, 5.2), rs('A', 'Discount', 2, 5.0),
  rs('A', 'NR1', 1, 3.7),
  rs('A', 'FR1', 1, 2),
  rs('A', 'SR3', 1, 1),
  // SR2/AR1 present but EXCLUDED for Type R
  rs('A', 'SR2', 1, 99), rs('A', 'AR1', 1, 99),
  // product B — current only, no previous
  rs('B', 'Discount', 1, 7, { priceList: 200, subsidy: 0, varCost: 150 }),
];
const PREV_R = [
  rs('A', 'Discount', 1, 4),
  rs('A', 'NR1', 1, 3),
  rs('A', 'FR1', 1, 1),
  rs('A', 'SR3', 1, 1),
];

test('computeRowsRS type R: grain last-page → int-cast → max, SR2/AR1 excluded', () => {
  const rows = computeRowsRS({ type: 'R', cur: CUR_R, prev: PREV_R });
  const a = rows.find((r) => r.productCode === 'A');
  assert.equal(a.rates.Discount, 5);       // trunc(5.2)=5 on last page only (4.9 on page1 ignored)
  assert.equal(a.rates.NR1, 3);            // trunc(3.7)
  assert.equal(a.rates.SR1, 0);            // absent → 0
  assert.equal(a.totalRebate, 3 + 0 + 2 + 1);          // SR2/AR1 NOT included for R
  assert.equal(a.total, 5 + 6);
  assert.equal(a.prev.total, 4 + 5);
  assert.equal(a.vsDiscount, 1);
  assert.equal(a.vsRebate, 1);
  assert.equal(a.priceExw, 100 - 11);
  assert.equal(a.ucmPrice, 89 + 10);
  assert.equal(a.commonMargin, 99 - 60);
  assert.equal(a.pctVsPriceList, '11.0');
});

test('computeRowsRS: product with no previous row → prev totals all 0', () => {
  const rows = computeRowsRS({ type: 'R', cur: CUR_R, prev: PREV_R });
  const b = rows.find((r) => r.productCode === 'B');
  assert.equal(b.prev.total, 0);
  assert.equal(b.vsDiscount, 7);
  assert.equal(b.total, 7);
});

test('computeRowsRS: previous matches by productCode case-insensitively', () => {
  const rows = computeRowsRS({ type: 'R', cur: [rs('a', 'Discount', 1, 5)], prev: [rs('A', 'Discount', 1, 3)] });
  assert.equal(rows[0].vsDiscount, 2);
});

test('computeRowsRS type S: SR2/AR1 included in totalRebate', () => {
  const curS = [
    rs('A', 'Discount', 1, 5), rs('A', 'NR1', 1, 3), rs('A', 'SR2', 1, 2), rs('A', 'AR1', 1, 4),
  ];
  const rows = computeRowsRS({ type: 'S', cur: curS, prev: [] });
  const a = rows[0];
  assert.equal(a.totalRebate, 3 + 2 + 4);
  assert.equal(a.total, 5 + 9);
  assert.equal(a.rates.SR2, 2);
  assert.equal(a.rates.AR1, 4);
});

test('computeRowsRS: pctVsPriceList = "0.0" when priceList is 0', () => {
  const rows = computeRowsRS({ type: 'R', cur: [rs('A', 'Discount', 1, 5, { priceList: 0 })], prev: [] });
  assert.equal(rows[0].pctVsPriceList, '0.0');
});

test('computeRowsRS: an existing all-negative rate keeps its max (BE ?? 0 only fires when NO rows)', () => {
  const rows = computeRowsRS({ type: 'R', cur: [rs('A', 'Discount', 1, -3), rs('A', 'Discount', 1, -7)], prev: [] });
  assert.equal(rows[0].rates.Discount, -3);   // max(-3,-7), not floored to 0
});

test('computeRowsRS: rows ordered by productCode', () => {
  const rows = computeRowsRS({ type: 'R', cur: [rs('Z', 'Discount', 1, 1), rs('A', 'Discount', 1, 1)], prev: [] });
  assert.deepEqual(rows.map((r) => r.productCode), ['A', 'Z']);
});

// --------------------------------------------------------- Type P engine ---

const tp = (productCode, shipTo, page, rate, over = {}) => ({
  productCode, productName: 'Prod ' + productCode, shipTo, page, rate,
  priceList: 100, subsidy: 10, varCost: 60, ...over,
});

test('computeRowsP: one UI row per (product, shipTo, page); PM joins the SAME page number', () => {
  const cur = [tp('A', 'S1', 1, 10), tp('A', 'S1', 2, 12)];
  const prev = [tp('A', 'S1', 1, 8)];  // page 2 has no previous → PM 0
  const rows = computeRowsP({ cur, prev });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].rate, 10);
  assert.equal(rows[0].pmRate, 8);
  assert.equal(rows[0].vsDiscount, 2);
  assert.equal(rows[1].pmRate, 0);     // gapped/missing page in previous → miss → 0
  assert.equal(rows[1].vsDiscount, 12);
});

test('computeRowsP mirrors the BE with-previous quirk: VAR_COST dropped → 0', () => {
  const rows = computeRowsP({ cur: [tp('A', 'S1', 1, 10)], prev: [tp('A', 'S1', 1, 8)] });
  assert.equal(rows[0].varCost, 0);                       // BE group-select omits VAR_COST
  assert.equal(rows[0].commonMargin, (100 - 10) + 10 - 0); // CM computed with the dropped value
  assert.equal(rows[0].quirks.varCostDropped, true);
});

test('computeRowsP no-previous path keeps VAR_COST', () => {
  const rows = computeRowsP({ cur: [tp('A', 'S1', 1, 10)], prev: [] });
  assert.equal(rows[0].varCost, 60);
  assert.equal(rows[0].quirks.varCostDropped, false);
});

test('computeRowsP ordering: productCode, shipTo, page', () => {
  const cur = [tp('B', 'S1', 1, 1), tp('A', 'S2', 1, 1), tp('A', 'S1', 2, 1), tp('A', 'S1', 1, 1)];
  const rows = computeRowsP({ cur, prev: [] });
  assert.deepEqual(rows.map((r) => `${r.productCode}/${r.shipTo}/${r.page}`), ['A/S1/1', 'A/S1/2', 'A/S2/1', 'B/S1/1']);
});

// -------------------------------------------------------------- buildDto ---

test('buildDto R+sdm produces BE field names with BE formatting', () => {
  const rows = computeRowsRS({ type: 'R', cur: CUR_R, prev: PREV_R });
  const dto = buildDto({ type: 'R', role: 'sdm', rows });
  const a = dto.find((d) => d.ProductCode === 'A');
  assert.equal(a.PriceList, '100');
  assert.equal(a.TotalRebate, '6');
  assert.equal(a.TotalDiscountAndRebate, '11');
  assert.equal(a.TotalDiscountAndRebatePrevious, '9');
  assert.equal(a.PriceEXW, '89');
  assert.equal(a.UCMPrice, '99');
  assert.equal(a.CommonMargin, '39');
  assert.equal(a.TotalDiscountRebateVSPriceList, '11.0');
  assert.equal(a.NormalRebate, undefined);   // breakdown columns are SAM-set only
});

test('buildDto R+sam exposes the rebate breakdown, no EXW/UCM/margin', () => {
  const rows = computeRowsRS({ type: 'R', cur: CUR_R, prev: PREV_R });
  const dto = buildDto({ type: 'R', role: 'sam', rows });
  const a = dto.find((d) => d.ProductCode === 'A');
  assert.equal(a.NormalRebate, '3');
  assert.equal(a.LoyaltyProgram, '1');
  assert.equal(a.PriceEXW, undefined);
  assert.equal(a.CommonMargin, undefined);
});

test('buildDto P uses TotalDiscount naming + ShipTo', () => {
  const rows = computeRowsP({ cur: [tp('A', 'S1', 1, 10)], prev: [tp('A', 'S1', 1, 8)] });
  const dto = buildDto({ type: 'P', role: 'sdm', rows });
  assert.equal(dto[0].ShipTo, 'S1');
  assert.equal(dto[0].TotalDiscount, '10');
  assert.equal(dto[0].TotalDiscountPrevious, '8');
  assert.equal(dto[0].VSDiscountPrevious, '2');
});

// --------------------------------------------------------- compareWithApi --

test('compareWithApi flags per-cell mismatches and counts matches', () => {
  const devkit = [{ ProductCode: 'A', PriceList: '100', TotalDiscountAndRebate: '11' }];
  const api = [{ ProductCode: 'A', PriceList: '100', TotalDiscountAndRebate: '14' }];
  const r = compareWithApi(devkit, api, 'ProductCode');
  assert.equal(r.matched, 1);                      // PriceList
  assert.equal(r.mismatches.length, 1);
  assert.deepEqual(r.mismatches[0], { key: 'A', field: 'TotalDiscountAndRebate', devkit: '11', api: '14' });
});

test('compareWithApi reports rows missing on either side', () => {
  const r = compareWithApi(
    [{ ProductCode: 'A', X: '1' }, { ProductCode: 'B', X: '2' }],
    [{ ProductCode: 'A', X: '1' }, { ProductCode: 'C', X: '3' }],
    'ProductCode',
  );
  assert.deepEqual(r.missingInApi, ['B']);
  assert.deepEqual(r.missingInDevkit, ['C']);
});

test('compareWithApi composite key for Type P rows', () => {
  const r = compareWithApi(
    [{ ProductCode: 'A', ShipTo: 'S1', No: 1, X: '1' }],
    [{ ProductCode: 'A', ShipTo: 'S1', No: 1, X: '1' }],
    ['ProductCode', 'ShipTo', 'No'],
  );
  assert.equal(r.matched, 1);
  assert.equal(r.mismatches.length, 0);
});

// ----------------------------------------------------------- orchestration --

const GUID = '11111111-1111-1111-1111-111111111111';
const PREV_GUID = '22222222-2222-2222-2222-222222222222';
const DB = { server: 'localhost', sam: { database: 'SamDb', user: 'sa', password: 'pw' } };

const RS_ROW = (productCode, rateType, page, rate) => ({
  productCode, productName: 'Prod ' + productCode, rateType, page, rate,
  priceList: 100, subsidy: 10, varCost: 60,
});

function fakeReadWide() {
  const calls = [];
  const readWide = async ({ sql }) => {
    calls.push(sql);
    if (/SELECT TOP 1/.test(sql)) return JSON.stringify({ id: GUID, groupId: 2, previousId: PREV_GUID, requestNo: 'REQ-1', version: 2 });
    if (/ProposalProductTypeRS/.test(sql) && sql.includes(PREV_GUID)) return JSON.stringify([RS_ROW('A', 'Discount', 1, 4)]);
    if (/ProposalProductTypeRS/.test(sql)) return JSON.stringify([RS_ROW('A', 'Discount', 1, 5), RS_ROW('A', 'NR1', 1, 3)]);
    throw new Error('unexpected sql: ' + sql.slice(0, 80));
  };
  return { readWide, calls };
}

test('xrayOverview wires header → type → rows → dto → columns', async () => {
  const { readWide } = fakeReadWide();
  const r = await xrayOverview({ db: DB, proposalId: GUID, role: 'sdm', readWide });
  assert.equal(r.type, 'R');
  assert.equal(r.track, 'sdm');
  assert.equal(r.rows[0].total, 8);
  assert.equal(r.dto[0].TotalDiscountAndRebate, '8');
  assert.equal(r.dto[0].TotalDiscountAndRebatePrevious, '4');
  // columns come from the field map for (R, sdm) and match dto fields
  assert.ok(r.columns.length > 5);
  for (const c of r.columns) assert.ok(c.key && c.label && c.source && c.anchor, c.key);
  assert.ok(r.columns.some((c) => c.key === 'TotalDiscountAndRebate'));
  assert.ok(!r.columns.some((c) => c.key === 'NormalRebate')); // sam-only column
});

test('xrayOverview role=sam exposes breakdown columns', async () => {
  const { readWide } = fakeReadWide();
  const r = await xrayOverview({ db: DB, proposalId: GUID, role: 'sam', readWide });
  assert.equal(r.track, 'sam');
  assert.ok(r.columns.some((c) => c.key === 'NormalRebate'));
  assert.equal(r.dto[0].NormalRebate, '3');
});

test('xrayOverview verify mode diffs against the API rows', async () => {
  const { readWide } = fakeReadWide();
  const verifyFetch = async () => ({ details: [{ ProductCode: 'A', PriceList: '100', TotalDiscountAndRebate: '9' }] });
  const r = await xrayOverview({ db: DB, proposalId: GUID, role: 'sdm', readWide, verifyFetch });
  assert.ok(r.verify);
  assert.equal(r.verify.mismatches.length, 1);
  assert.equal(r.verify.mismatches[0].field, 'TotalDiscountAndRebate');
  assert.equal(r.verify.mismatches[0].api, '9');
});

test('xrayOverview rejects bad GUID + non-dev server', async () => {
  await assert.rejects(() => xrayOverview({ db: DB, proposalId: 'zzz', readWide: async () => '' }), /GUID/i);
  await assert.rejects(() => xrayOverview({ db: { ...DB, server: 'sql-prod' }, proposalId: GUID, readWide: async () => '' }), /non-dev/i);
});

test('FIELD_MAP covers all six (type × track) sets with anchors', () => {
  for (const type of ['R', 'S', 'P']) {
    for (const track of ['sam', 'sdm']) {
      const cols = FIELD_MAP[type][track];
      assert.ok(cols.length >= 6, `${type}/${track}`);
      for (const c of cols) assert.match(c.anchor, /OverviewDetailType|OverViewDetailType/, `${type}/${track}/${c.key}`);
    }
  }
});
