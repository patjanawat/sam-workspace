// Screen X-ray: Approval › Overview list — devkit recomputes the table the BE
// builds in Features/Approval/{Sam,Sdm}/GetById/OverviewDetailType{R,S,P}.cs,
// exposing per-column source / grain / formula / intermediates, and (verify
// mode) diffing its numbers against the live API response.
//
// Formula source of truth (read 2026-07-04, verify against code on change):
//   Sam/GetById/OverviewDetailTypeR.cs   — short set + rebate breakdown
//   Sdm/GetById/OverviewDetailTypeR.cs   — long set (EXW/UCM/Var-Cost/CM/%vsPL)
//   Sdm/GetById/OverviewDetailTypeS.cs   — like R but SR2/AR1 join the rebate sum
//   Sdm/GetById/OverviewDetailTypeP.cs   — per (product, shipTo, page); PM joins
//                                          the SAME page number; with-previous
//                                          path drops VAR_COST (stays 0)

import { assertDevDbServer } from './guard.mjs';
import { runSqlWide } from './db.mjs';

const GUID_RE = /^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$/;
const esc = (v) => String(v).replace(/'/g, "''");

// RateTypeCode constants (Shared/Constants/RateType.cs)
const RATE_KEYS = ['Discount', 'NR1', 'SR1', 'FR1', 'SR3', 'SR2', 'AR1'];
// Excluded from the overview grain per type (Sam+Sdm OverviewDetailType*.cs)
const EXCLUDED = {
  R: new Set(['SR2', 'AR1', 'SR4', 'AR2']),
  S: new Set(['SR4', 'AR2']),
};

// ---------------------------------------------------------------- format ---

// BE: v.ToString("#,##0", InvariantCulture)
export function fmt(n) {
  return Math.trunc(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
}
// BE: v.ToString("#,##0.0", InvariantCulture) — round half away from zero
export function fmt1(n) {
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

// ---------------------------------------------------------- Type R/S grain --

// C# `(int?)x.RATE` truncates toward zero per row, then Max.
const intCast = (v) => Math.trunc(Number(v) || 0);

// Grain per (productCode, rateType): last page → per-row int cast → max.
// Returns Map productCode → { productName, first: {priceList, subsidy, varCost}, rates }
function collapseRS(rows, type) {
  const excluded = EXCLUDED[type];
  const kept = rows.filter((r) => !excluded.has(r.rateType));

  const lastPage = new Map(); // product|rateType → max page
  for (const r of kept) {
    const k = `${r.productCode}|${r.rateType}`;
    if (!lastPage.has(k) || r.page > lastPage.get(k)) lastPage.set(k, r.page);
  }
  const lastRows = kept.filter((r) => r.page === lastPage.get(`${r.productCode}|${r.rateType}`));

  const byProduct = new Map();
  for (const r of lastRows) {
    let p = byProduct.get(r.productCode);
    if (!p) {
      // BE takes g.First() for these — first last-page row seen (non-deterministic
      // in the BE when values differ across rows; we mirror "first row").
      p = {
        productCode: r.productCode,
        productName: r.productName,
        first: { priceList: r.priceList, subsidy: r.subsidy, varCost: r.varCost },
        rates: Object.fromEntries(RATE_KEYS.map((k) => [k, null])), // null = no rows yet (BE ?? 0 later)
      };
      byProduct.set(r.productCode, p);
    }
    const cast = intCast(r.rate);
    p.rates[r.rateType] = p.rates[r.rateType] === null ? cast : Math.max(p.rates[r.rateType], cast);
  }
  // coalesce like the BE: Max(...) ?? 0 — only when the type had NO rows
  for (const p of byProduct.values()) {
    for (const k of RATE_KEYS) if (p.rates[k] === null) p.rates[k] = 0;
  }
  return byProduct;
}

const REBATE_KEYS = { R: ['NR1', 'SR1', 'FR1', 'SR3'], S: ['NR1', 'SR1', 'FR1', 'SR2', 'AR1', 'SR3'] };

// Full Type R/S computation: current + previous → UI rows with intermediates.
export function computeRowsRS({ type, cur, prev }) {
  const curMap = collapseRS(cur, type);
  const prevMap = collapseRS(prev, type);
  // previous dict is matched case-insensitively (StringComparer.OrdinalIgnoreCase)
  const prevByFold = new Map([...prevMap.values()].map((p) => [p.productCode.toLowerCase(), p]));

  const rebateKeys = REBATE_KEYS[type];
  return [...curMap.values()]
    .sort((a, b) => a.productCode.localeCompare(b.productCode))
    .map((c) => {
      const p = prevByFold.get(c.productCode.toLowerCase());
      const prevRates = p ? p.rates : Object.fromEntries(RATE_KEYS.map((k) => [k, 0]));

      const totalRebate = rebateKeys.reduce((s, k) => s + c.rates[k], 0);
      const prevTotalRebate = rebateKeys.reduce((s, k) => s + prevRates[k], 0);
      const total = c.rates.Discount + totalRebate;
      const prevTotal = prevRates.Discount + prevTotalRebate;
      const priceExw = c.first.priceList - total;
      const ucmPrice = priceExw + c.first.subsidy;
      const commonMargin = ucmPrice - c.first.varCost;
      const pctVsPriceList = c.first.priceList === 0 ? '0.0' : fmt1((total / c.first.priceList) * 100);

      return {
        productCode: c.productCode,
        productName: c.productName,
        priceList: c.first.priceList,
        subsidy: c.first.subsidy,
        varCost: c.first.varCost,
        rates: c.rates,
        totalRebate,
        total,
        prev: { rates: prevRates, totalRebate: prevTotalRebate, total: prevTotal, found: Boolean(p) },
        vsDiscount: c.rates.Discount - prevRates.Discount,
        vsRebate: totalRebate - prevTotalRebate,
        priceExw,
        ucmPrice,
        commonMargin,
        pctVsPriceList,
      };
    });
}

// ------------------------------------------------------------ Type P engine --

// One UI row per (productCode, shipTo, page) — every page shows.
// PM joins the previous proposal's row with the SAME page number (gapped pages
// miss → 0). With-previous path mirrors the BE quirk: VAR_COST is not selected
// in the group projection, so it computes as 0 (Sdm/OverviewDetailTypeP.cs).
export function computeRowsP({ cur, prev }) {
  // BE picks the with-previous code path whenever Proposal.PreviousId != null;
  // callers pass prev=[] for the no-previous path.
  const withPrevPath = Array.isArray(prev) && prev.length > 0;

  const prevByKey = new Map();
  for (const r of prev) {
    const k = `${r.productCode}|${r.shipTo}|${r.page}`;
    const existing = prevByKey.get(k);
    const cast = intCast(r.rate);
    prevByKey.set(k, existing === undefined ? cast : Math.max(existing, cast));
  }

  const byKey = new Map();
  for (const r of cur) {
    const k = `${r.productCode}|${r.shipTo}|${r.page}`;
    let row = byKey.get(k);
    if (!row) {
      row = { ...r, rate: Number(r.rate) || 0 };
      byKey.set(k, row);
    } else {
      row.rate = Math.max(row.rate, Number(r.rate) || 0);
    }
  }

  return [...byKey.values()]
    .sort((a, b) => a.productCode.localeCompare(b.productCode) || String(a.shipTo).localeCompare(String(b.shipTo)) || a.page - b.page)
    .map((r) => {
      const pmRate = prevByKey.get(`${r.productCode}|${r.shipTo}|${r.page}`) ?? 0;
      const varCost = withPrevPath ? 0 : r.varCost; // BE quirk — see header comment
      const priceExw = r.priceList - r.rate;
      const ucmPrice = priceExw + r.subsidy;
      return {
        productCode: r.productCode,
        productName: r.productName,
        shipTo: r.shipTo,
        page: r.page,
        priceList: r.priceList,
        subsidy: r.subsidy,
        rate: r.rate,
        pmRate,
        vsDiscount: r.rate - pmRate,
        priceExw,
        ucmPrice,
        varCost,
        commonMargin: ucmPrice - varCost,
        pctVsPriceList: r.priceList === 0 ? '0.0' : fmt1((r.rate / r.priceList) * 100),
        quirks: { varCostDropped: withPrevPath },
      };
    });
}
// ------------------------------------------------------------------- DTOs ---

// Column sets exactly as the BE DTOs expose them, per (type, role-track).
export function buildDto({ type, role, rows }) {
  const track = role === 'sam' ? 'sam' : 'sdm';
  if (type === 'P') {
    return rows.map((r, idx) => ({
      No: idx + 1,
      ProductCode: r.productCode,
      ProductName: r.productName,
      ShipTo: r.shipTo,
      PriceList: fmt(r.priceList),
      FreightSubsidy: fmt(r.subsidy),
      TotalDiscount: fmt(r.rate),
      TotalDiscountPrevious: fmt(r.pmRate),
      VSDiscountPrevious: fmt(r.vsDiscount),
      ...(track === 'sdm' && {
        PriceEXW: fmt(r.priceExw),
        UCMPrice: fmt(r.ucmPrice),
        TotalDiscountVSPriceList: r.pctVsPriceList,
        VarCost: fmt(r.varCost),
        CommonMargin: fmt(r.commonMargin),
      }),
    }));
  }
  return rows.map((r, idx) => ({
    No: idx + 1,
    ProductCode: r.productCode,
    ProductName: r.productName,
    PriceList: fmt(r.priceList),
    Discount: fmt(r.rates.Discount),
    FreightSubsidy: fmt(r.subsidy),
    TotalDiscountAndRebate: fmt(r.total),
    TotalDiscountAndRebatePrevious: fmt(r.prev.total),
    VSDiscountPrevious: fmt(r.vsDiscount),
    VSRebatePrevious: fmt(r.vsRebate),
    ...(track === 'sam' && {
      NormalRebate: fmt(r.rates.NR1),
      SpecialRebate: fmt(r.rates.SR1),
      FreightRebate: fmt(r.rates.FR1),
      LoyaltyProgram: fmt(r.rates.SR3),
      ...(type === 'S' && { SpecialAdditional: fmt(r.rates.SR2), Accumulate: fmt(r.rates.AR1) }),
    }),
    ...(track === 'sdm' && {
      TotalRebate: fmt(r.totalRebate),
      PriceEXW: fmt(r.priceExw),
      UCMPrice: fmt(r.ucmPrice),
      TotalDiscountRebateVSPriceList: r.pctVsPriceList,
      VarCost: fmt(r.varCost),
      CommonMargin: fmt(r.commonMargin),
    }),
  }));
}

// -------------------------------------------------------------- field map ---

// Per-column provenance shown in the UI. Anchors point at the real BE files —
// re-verify against them whenever the BE formulas change.
const ANCHOR = {
  R: { sam: 'Sam/GetById/OverviewDetailTypeR.cs', sdm: 'Sdm/GetById/OverviewDetailTypeR.cs' },
  S: { sam: 'Sam/GetById/OverviewDetailTypeS.cs', sdm: 'Sdm/GetById/OverviewDetailTypeS.cs' },
  P: { sam: 'Sam/GetById/OverViewDetailTypeP.cs', sdm: 'Sdm/GetById/OverviewDetailTypeP.cs' },
};

const GRAIN_RS = 'ต่อ (PRODUCT_CODE, RATE_TYPE): last page = max(PAGE) → int-cast ต่อแถว → max(RATE) · exclude ' ;
const GRAIN_P = '1 แถว = (PRODUCT_CODE, SHIP_TO, PAGE) — โชว์ทุกหน้า · PM จับคู่เลขหน้าเดียวกันตรง ๆ (page หายใน previous → 0)';
const SRC_RATE = (rt, label) => ({ source: `ProposalProductTypeRS.RATE filter RATE_TYPE='${rt}'`, formula: `${label} = RATE ตาม grain rule` });
const SRC_FIRST = (col) => `ProposalProductTypeRS.${col} — g.First() ไม่ sort (non-deterministic ถ้าแถวไม่ uniform)`;

function rsColumns(type, track) {
  const ex = type === 'R' ? 'SR2/AR1/SR4/AR2' : 'SR4/AR2';
  const grain = GRAIN_RS + ex;
  const anchor = ANCHOR[type][track];
  const rebateSum = type === 'R' ? 'NR1 + SR1 + FR1 + SR3' : 'NR1 + SR1 + FR1 + SR2 + AR1 + SR3';
  const cols = [
    { key: 'ProductCode', label: 'Product', source: 'ProposalProductTypeRS.PRODUCT_CODE', grain, formula: '—', anchor },
    { key: 'PriceList', label: 'Price List', source: SRC_FIRST('PRICE_LIST') + ' · snapshot จาก warehouse.Product ตอน save', grain, formula: 'pass-through', anchor },
    { key: 'Discount', label: 'Disc.', ...SRC_RATE('Discount', 'Disc.'), grain, anchor },
  ];
  if (track === 'sam') {
    cols.push(
      { key: 'NormalRebate', label: 'Nor. Reb.', ...SRC_RATE('NR1', 'Nor. Reb.'), grain, anchor },
      { key: 'SpecialRebate', label: 'Spec. Reb.', ...SRC_RATE('SR1', 'Spec. Reb.'), grain, anchor },
      { key: 'FreightRebate', label: 'Frei. Reb.', ...SRC_RATE('FR1', 'Frei. Reb.'), grain, anchor },
    );
    if (type === 'S') cols.push(
      { key: 'SpecialAdditional', label: 'Spec. Add.', ...SRC_RATE('SR2', 'Spec. Add.'), grain, anchor },
      { key: 'Accumulate', label: 'Accum.', ...SRC_RATE('AR1', 'Accum.'), grain, anchor },
    );
    cols.push({ key: 'LoyaltyProgram', label: 'Lyt. Prog.', ...SRC_RATE('SR3', 'Lyt. Prog.'), grain, anchor });
  } else {
    cols.push({ key: 'TotalRebate', label: 'Tot. Reb.', source: 'คำนวณ', grain, formula: rebateSum, anchor });
  }
  cols.push({
    key: 'FreightSubsidy', label: 'Net Freight',
    source: SRC_FIRST('SUBSIDY') + ' · chain: ACCDW → sp_Sync_Subsidy → warehouse.Subsidy.FREIGHT_SUBSIDY_BT → OUTER APPLY ตอน save (level-1 เท่านั้น, ไม่ match → 0)',
    grain, formula: 'ไม่เข้าสูตร Tot. Disc./Reb.', anchor,
    warn: 'label หลอก — ค่าจริงคือ Freight Subsidy · snapshot at save-time: sync ใหม่หลัง save ไม่เปลี่ยนค่านี้',
  });
  if (track === 'sdm') cols.push(
    { key: 'PriceEXW', label: 'Price EXW', source: 'คำนวณ', grain, formula: 'PRICE_LIST − Tot. Disc./Reb.', anchor },
    { key: 'UCMPrice', label: 'UCM', source: 'คำนวณ', grain, formula: 'Price EXW + SUBSIDY', anchor },
  );
  cols.push(
    { key: 'TotalDiscountAndRebate', label: 'Tot. Disc./Reb.', source: 'คำนวณ', grain, formula: `Disc + ${rebateSum} (ไม่รวม SUBSIDY)`, anchor },
    { key: 'TotalDiscountAndRebatePrevious', label: 'PM. Disc./Reb.', source: 'query เดียวกันบน Proposal.PreviousId (1 ระดับ)', grain: 'จับคู่ PRODUCT_CODE (case-insensitive) — ไม่เจอ = 0', formula: `Disc + ${rebateSum} ของ previous`, anchor },
    { key: 'VSDiscountPrevious', label: 'vs PM. Disc.', source: 'คำนวณ', grain: 'discount อย่างเดียว', formula: 'Disc(cur) − Disc(prev)', anchor },
    { key: 'VSRebatePrevious', label: 'vs PM. Reb.', source: 'คำนวณ', grain: 'rebate ไม่รวม discount', formula: 'ΣRebate(cur) − ΣRebate(prev)', anchor },
  );
  if (track === 'sdm') cols.push(
    { key: 'TotalDiscountRebateVSPriceList', label: '% vs PL', source: 'คำนวณ', grain, formula: 'Tot ÷ PRICE_LIST × 100 ("#,##0.0" · PL=0 → "0.0")', anchor },
    { key: 'VarCost', label: 'Var-Cost', source: SRC_FIRST('VAR_COST'), grain, formula: 'pass-through', anchor },
    { key: 'CommonMargin', label: 'Comm. Margin', source: 'คำนวณ', grain, formula: 'UCM − VAR_COST', anchor },
  );
  return cols;
}

function pColumns(track) {
  const anchor = ANCHOR.P[track];
  const cols = [
    { key: 'ProductCode', label: 'Product', source: 'ProposalProductTypeP.PRODUCT_CODE', grain: GRAIN_P, formula: '—', anchor },
    { key: 'ShipTo', label: 'Ship To', source: 'ProposalProductTypeP.SHIP_TO', grain: GRAIN_P, formula: '—', anchor },
    { key: 'PriceList', label: 'Price List', source: 'ProposalProductTypeP.PRICE_LIST', grain: GRAIN_P, formula: 'pass-through', anchor },
    { key: 'FreightSubsidy', label: 'Net Freight', source: 'ProposalProductTypeP.SUBSIDY (label หลอก — Freight Subsidy snapshot)', grain: GRAIN_P, formula: 'ไม่เข้าสูตรส่วนลด', anchor, warn: 'label หลอก — ค่าจริงคือ Freight Subsidy snapshot at save-time' },
    { key: 'TotalDiscount', label: 'Tot. Disc.', source: 'ProposalProductTypeP.RATE — ก้อนเดียว = ส่วนลดรวม (Type P ไม่มี rebate ย่อย)', grain: GRAIN_P, formula: 'max(RATE) ในกลุ่ม (product, shipTo, page)', anchor },
    { key: 'TotalDiscountPrevious', label: 'PM. Disc.', source: 'แถว previous ที่ PAGE เดียวกัน', grain: GRAIN_P, formula: 'max((int)RATE) ?? 0', anchor },
    { key: 'VSDiscountPrevious', label: 'vs PM. Disc.', source: 'คำนวณ', grain: GRAIN_P, formula: 'RATE − PM_RATE', anchor },
  ];
  if (track === 'sdm') cols.push(
    { key: 'PriceEXW', label: 'Price EXW', source: 'คำนวณ', grain: GRAIN_P, formula: 'PRICE_LIST − RATE', anchor },
    { key: 'UCMPrice', label: 'UCM', source: 'คำนวณ', grain: GRAIN_P, formula: '(PRICE_LIST − RATE) + SUBSIDY', anchor },
    { key: 'TotalDiscountVSPriceList', label: '% vs PL', source: 'คำนวณ', grain: GRAIN_P, formula: 'RATE ÷ PRICE_LIST × 100', anchor },
    { key: 'VarCost', label: 'Var-Cost', source: 'ProposalProductTypeP.VAR_COST', grain: GRAIN_P, formula: 'pass-through', anchor, warn: 'BE quirk: path ที่มี previous ไม่ select VAR_COST ใน group projection → ค่าเป็น 0 เสมอ (และ Comm. Margin เพี้ยนตาม) — Sdm/OverviewDetailTypeP.cs GetDataWithPrevious' },
    { key: 'CommonMargin', label: 'Comm. Margin', source: 'คำนวณ', grain: GRAIN_P, formula: 'UCM − VAR_COST (VAR_COST=0 เมื่อมี previous — ดู warn ที่ Var-Cost)', anchor },
  );
  return cols;
}

export const FIELD_MAP = {
  R: { sam: rsColumns('R', 'sam'), sdm: rsColumns('R', 'sdm') },
  S: { sam: rsColumns('S', 'sam'), sdm: rsColumns('S', 'sdm') },
  P: { sam: pColumns('sam'), sdm: pColumns('sdm') },
};

// ----------------------------------------------------------- orchestration --

const GROUP_LETTER = { 1: 'P', 2: 'R', 3: 'S' };

const rsRowsSql = (id) => `SET NOCOUNT ON;
DECLARE @j NVARCHAR(MAX) = (
  SELECT PRODUCT_CODE AS productCode, PRODUCT_NAME AS productName, RATE_TYPE AS rateType,
    PAGE AS page, RATE AS rate, PRICE_LIST AS priceList, SUBSIDY AS subsidy, VAR_COST AS varCost
  FROM dbo.ProposalProductTypeRS WHERE PROPOSAL_ID = '${id}'
  FOR JSON PATH);
SELECT ISNULL(@j, '[]');`;

const pRowsSql = (id) => `SET NOCOUNT ON;
DECLARE @j NVARCHAR(MAX) = (
  SELECT PRODUCT_CODE AS productCode, PRODUCT_NAME AS productName, SHIP_TO AS shipTo,
    PAGE AS page, RATE AS rate, PRICE_LIST AS priceList, SUBSIDY AS subsidy, VAR_COST AS varCost
  FROM dbo.ProposalProductTypeP WHERE PROPOSAL_ID = '${id}'
  FOR JSON PATH);
SELECT ISNULL(@j, '[]');`;

// Find the overview rows inside an arbitrary API response shape: the first
// array of objects that carry a ProductCode field.
function findApiRows(obj, depth = 0) {
  if (!obj || depth > 4) return null;
  if (Array.isArray(obj)) {
    return obj.length && typeof obj[0] === 'object' && obj[0] !== null && 'ProductCode' in obj[0] ? obj : null;
  }
  if (typeof obj === 'object') {
    for (const v of Object.values(obj)) {
      const hit = findApiRows(v, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

export async function xrayOverview({ db, proposalId, role = 'sdm', readWide = runSqlWide, verifyFetch = null, log = () => {} }) {
  if (!GUID_RE.test(proposalId || '')) throw new Error(`Invalid proposalId (must be GUID): ${proposalId}`);
  assertDevDbServer(db.server, db.allowedServers);
  const sam = { server: db.server, ...db.sam };
  const id = esc(proposalId);
  const track = role === 'sam' ? 'sam' : 'sdm';

  const headJson = await readWide({
    ...sam,
    sql: `SET NOCOUNT ON;
DECLARE @j NVARCHAR(MAX) = (
  SELECT TOP 1 CONVERT(NVARCHAR(36), Id) AS id, ProposalGroupId AS groupId,
    CONVERT(NVARCHAR(36), PreviousId) AS previousId, RequestNo AS requestNo, Version AS version
  FROM dbo.Proposal WHERE Id = '${id}'
  FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
SELECT ISNULL(@j, '');`,
  });
  if (!headJson || !headJson.trim()) throw new Error('Proposal not found.');
  const head = JSON.parse(headJson);
  const type = GROUP_LETTER[head.groupId];
  if (!type) throw new Error(`Unknown ProposalGroupId=${head.groupId}`);
  log(`[kit] x-ray ${head.requestNo} v${head.version} — Type ${type} · view as ${track}`);

  const rowsSql = type === 'P' ? pRowsSql : rsRowsSql;
  const cur = JSON.parse(await readWide({ ...sam, sql: rowsSql(id) }) || '[]');
  const prev = head.previousId
    ? JSON.parse(await readWide({ ...sam, sql: rowsSql(esc(head.previousId)) }) || '[]')
    : [];
  log(`[kit] rows: current ${cur.length} · previous ${prev.length}${head.previousId ? '' : ' (no PreviousId)'}`);

  const rows = type === 'P' ? computeRowsP({ cur, prev }) : computeRowsRS({ type, cur, prev });
  const dto = buildDto({ type, role: track, rows });
  const columns = FIELD_MAP[type][track];

  let verify = null;
  if (verifyFetch) {
    log(`[kit] verify: GET /approval/${track}/{id} and diff`);
    const resp = await verifyFetch(track, proposalId);
    const apiRows = findApiRows(resp);
    if (!apiRows) {
      verify = { error: 'could not locate overview rows in the API response' };
      log('[kit] verify: no ProductCode rows found in response');
    } else {
      const keys = type === 'P' ? ['ProductCode', 'ShipTo', 'No'] : ['ProductCode'];
      verify = compareWithApi(dto, apiRows, keys);
      log(`[kit] verify: ${verify.matched} match · ${verify.mismatches.length} mismatch`
        + (verify.missingInApi.length ? ` · missing in API: ${verify.missingInApi.length}` : '')
        + (verify.missingInDevkit.length ? ` · missing in devkit: ${verify.missingInDevkit.length}` : ''));
    }
  }

  return {
    proposal: { id: head.id, requestNo: head.requestNo, version: head.version, previousId: head.previousId ?? null },
    type,
    role,
    track,
    columns,
    rows,
    dto,
    verify,
  };
}

// ---------------------------------------------------------------- compare ---

// Diff devkit-recomputed DTOs against the live API's rows, cell by cell.
export function compareWithApi(devkitRows, apiRows, keyFields) {
  const keys = Array.isArray(keyFields) ? keyFields : [keyFields];
  const keyOf = (r) => keys.map((k) => String(r[k] ?? '')).join('|');
  const apiByKey = new Map(apiRows.map((r) => [keyOf(r), r]));
  const devkitKeys = new Set(devkitRows.map(keyOf));

  let matched = 0;
  const mismatches = [];
  const missingInApi = [];
  for (const d of devkitRows) {
    const a = apiByKey.get(keyOf(d));
    if (!a) { missingInApi.push(keyOf(d)); continue; }
    for (const [field, val] of Object.entries(d)) {
      if (keys.includes(field) || field === 'No' || field === 'ProductName') continue;
      if (!(field in a)) continue; // API may omit optional fields
      if (String(a[field] ?? '') === String(val ?? '')) matched++;
      else mismatches.push({ key: keyOf(d), field, devkit: String(val ?? ''), api: String(a[field] ?? '') });
    }
  }
  const missingInDevkit = apiRows.filter((r) => !devkitKeys.has(keyOf(r))).map(keyOf);
  return { matched, mismatches, missingInApi, missingInDevkit };
}
