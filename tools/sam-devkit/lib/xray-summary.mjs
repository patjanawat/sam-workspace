// Screen X-ray: Request › Summary footer — Current / Latest Approved / Changed.
//
// Mirrors two independent grains (สับสนกันประจำ — proposal.md §P.M. Max):
//   Current        = FE accumulateMaxBySection (rebate-footer.mapper.tsx):
//                    per section, last non-deleted page WITH a countable row →
//                    max(new) per product; sections summed per product.
//   Latest Approved= BE pmBaselineBySection (GetProposalDetailByIdQueryHandler):
//                    previous proposal's ProposalProductTypeRS → max(RATE) per
//                    (PAGE, PRODUCT, RATE_TYPE) → ReindexBaselinePages (gapped
//                    {1,4} → {1,2}) → CollapseToLastPagePerSection (highest page
//                    wins per section+product) + Discount as "discountHeader" →
//                    Σ per product. Constant — editing the draft never moves it.
//   Changed        = Current − Latest.
// No previous proposal → Latest falls back to max(old) per section on the last
// non-added countable page (FE fallback path; BE injects nothing on create).

import { assertDevDbServer } from './guard.mjs';
import { runSqlWide } from './db.mjs';

const GUID_RE = /^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$/;
const esc = (v) => String(v).replace(/'/g, "''");

// RebateHelpers.RateTypeToSectionKey — Discount + SR4/AR2 intentionally absent
export const RATE_TYPE_TO_SECTION = {
  NR1: 'normalRebate',
  SR1: 'specialRebate',
  FR1: 'freightRebate',
  SR3: 'loyaltyProgram',
  SR2: 'specialAdditionalTHBTon',
  AR1: 'accumulateTHBT',
};
const DISCOUNT_SECTION = 'discountHeader';

// ---------------------------------------------------------------- baseline --

// BuildPmMaxBaselineAsync + BuildDiscountBaselineAsync:
// rows → { baseline: page→section→product→maxRate, discountByPage: page→product→maxRate }
export function buildBaseline(rows) {
  const baseline = {};
  const discountByPage = {};
  for (const r of rows) {
    if (r.rateType === 'Discount') {
      const byProduct = (discountByPage[r.page] ??= {});
      byProduct[r.productCode] = Math.max(byProduct[r.productCode] ?? -Infinity, r.rate);
      continue;
    }
    const section = RATE_TYPE_TO_SECTION[r.rateType];
    if (!section) continue; // SR4/AR2 and anything unmapped
    const bySection = (baseline[r.page] ??= {});
    const byProduct = (bySection[section] ??= {});
    byProduct[r.productCode] = Math.max(byProduct[r.productCode] ?? -Infinity, r.rate);
  }
  return { baseline, discountByPage };
}

// ReindexBaselinePages: union of page keys sorted ascending → contiguous 1..N
function reindexPages(baseline, discountByPage) {
  const pages = [...new Set([...Object.keys(baseline), ...Object.keys(discountByPage)].map(Number))].sort((a, b) => a - b);
  const remap = new Map(pages.map((p, i) => [p, i + 1]));
  const rb = Object.fromEntries(Object.entries(baseline).map(([p, v]) => [remap.get(Number(p)), v]));
  const rd = Object.fromEntries(Object.entries(discountByPage).map(([p, v]) => [remap.get(Number(p)), v]));
  return { baseline: rb, discountByPage: rd };
}

// CollapseToLastPagePerSection: highest page wins per (section, product);
// discount merges in under "discountHeader".
export function collapseLastPagePerSection(baselineRaw, discountRaw) {
  const { baseline, discountByPage } = reindexPages(baselineRaw, discountRaw);
  const collapsed = new Map(); // section → Map(product → value)
  const put = (section, product, value) => {
    let m = collapsed.get(section);
    if (!m) { m = new Map(); collapsed.set(section, m); }
    if (!m.has(product)) m.set(product, value); // first write = highest page
  };
  const descPages = (obj) => Object.keys(obj).map(Number).sort((a, b) => b - a);
  for (const page of descPages(baseline)) {
    for (const [section, byProduct] of Object.entries(baseline[page])) {
      for (const [product, value] of Object.entries(byProduct)) put(section, product, value);
    }
  }
  for (const page of descPages(discountByPage)) {
    for (const [product, value] of Object.entries(discountByPage[page])) put(DISCOUNT_SECTION, product, value);
  }
  return [...collapsed.entries()].map(([section, m]) => ({
    section,
    products: [...m.entries()].map(([productId, value]) => ({ productId, value })),
  }));
}

// ----------------------------------------------------------------- payload --

const parseNum = (x) => {
  if (typeof x === 'number') return Number.isFinite(x) ? x : 0;
  if (typeof x === 'string') { const n = Number(x.replace(/,/g, '')); return Number.isFinite(n) ? n : 0; }
  return 0;
};

// Parse the stored multi-page wrapper; pages[].payload is a double-encoded
// section array. Defaults mirror RebateHelpers.ApplyPageDefaults.
function parsePages(payloadJson) {
  if (!payloadJson || typeof payloadJson !== 'string') return [];
  let root;
  try { root = JSON.parse(payloadJson); } catch { return []; }
  const pages = Array.isArray(root?.pages) ? root.pages : [];
  return pages.map((p, i) => {
    let sections = p?.payload;
    if (typeof sections === 'string') {
      try { sections = JSON.parse(sections); } catch { sections = []; }
    }
    return {
      pageNumber: p?.pageNumber ?? i + 1,
      deleted: p?.deleted === true,
      isAddedPage: p?.isAddedPage === true,
      sections: Array.isArray(sections) ? sections : [],
    };
  });
}

const countable = (row, sectionKey) => row?.range != null || sectionKey === DISCOUNT_SECTION;

// Per-section pass over pages: pick the last qualifying page per section and
// reduce its rows with `take(values, acc)`.
function lastPageMaxBySection(pages, field, { skipAdded = false } = {}) {
  const lastPage = new Map(); // section → {pageNumber, sec}
  for (const page of pages) {
    if (page.deleted) continue;
    if (skipAdded && page.isAddedPage) continue;
    for (const s of page.sections) {
      if (!s?.section) continue;
      if (!(s.rows ?? []).some((row) => countable(row, s.section))) continue;
      const cur = lastPage.get(s.section);
      if (!cur || page.pageNumber > cur.pageNumber) lastPage.set(s.section, { pageNumber: page.pageNumber, sec: s });
    }
  }
  const bySection = {};
  for (const [sectionKey, { sec }] of lastPage) {
    const byProduct = {};
    for (const row of sec.rows ?? []) {
      if (!countable(row, sectionKey)) continue;
      for (const v of row.values ?? []) {
        if (!v?.productId) continue;
        byProduct[v.productId] = Math.max(byProduct[v.productId] ?? 0, parseNum(v[field] ?? 0));
      }
    }
    bySection[sectionKey] = byProduct;
  }
  return bySection;
}

// FE accumulateMaxBySection "current" leg: max(new), added pages included.
export function computeCurrent(payloadJson) {
  const pages = parsePages(payloadJson);
  const bySection = lastPageMaxBySection(pages, 'new');
  const productIds = [];
  const seen = new Set();
  for (const page of pages) {
    for (const s of page.sections) {
      for (const row of s.rows ?? []) {
        for (const v of row.values ?? []) {
          if (v?.productId && !seen.has(v.productId)) { seen.add(v.productId); productIds.push(v.productId); }
        }
      }
    }
  }
  return { bySection, productIds };
}

// ------------------------------------------------------------------ footer --

export function computeSummaryFooter({ payloadJson, prevRows }) {
  const { bySection: currentBySection, productIds } = computeCurrent(payloadJson);

  let latestItems;
  let baselineUsed;
  if (Array.isArray(prevRows) && prevRows.length) {
    const { baseline, discountByPage } = buildBaseline(prevRows);
    latestItems = collapseLastPagePerSection(baseline, discountByPage);
    baselineUsed = 'recomputed';
  } else {
    // FE fallback: max(old) per section, added pages excluded (SAM-1767)
    const oldBySection = lastPageMaxBySection(parsePages(payloadJson), 'old', { skipAdded: true });
    latestItems = Object.entries(oldBySection).map(([section, byProduct]) => ({
      section,
      products: Object.entries(byProduct).map(([productId, value]) => ({ productId, value })),
    }));
    baselineUsed = 'fallback-old';
  }

  const idx = new Map(productIds.map((p, i) => [p, i]));
  const current = Array(productIds.length).fill(0);
  const latest = Array(productIds.length).fill(0);
  for (const byProduct of Object.values(currentBySection)) {
    for (const [pid, v] of Object.entries(byProduct)) {
      const i = idx.get(pid);
      if (i !== undefined) current[i] += v;
    }
  }
  for (const entry of latestItems) {
    for (const p of entry.products) {
      const i = idx.get(p.productId);
      if (i !== undefined) latest[i] += p.value;
    }
  }

  return {
    baselineUsed,
    perProduct: productIds.map((productId, i) => ({
      productId,
      current: current[i],
      latest: latest[i],
      changed: current[i] - latest[i],
    })),
    currentBySection,
    latestBySection: latestItems,
  };
}

// ----------------------------------------------------------- orchestration --

export async function xraySummary({ db, proposalId, readWide = runSqlWide, log = () => {} }) {
  if (!GUID_RE.test(proposalId || '')) throw new Error(`Invalid proposalId (must be GUID): ${proposalId}`);
  assertDevDbServer(db.server, db.allowedServers);
  const sam = { server: db.server, ...db.sam };
  const id = esc(proposalId);

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
  log(`[kit] summary x-ray ${head.requestNo} v${head.version}${head.previousId ? '' : ' — no PreviousId (fallback-old baseline)'}`);

  const payloadJson = await readWide({
    ...sam,
    sql: `SET NOCOUNT ON; SELECT RebatePayload FROM dbo.ProposalDetail WHERE ProposalId='${id}';`,
  });

  let prevRows = null;
  if (head.previousId) {
    prevRows = JSON.parse(await readWide({
      ...sam,
      sql: `SET NOCOUNT ON;
DECLARE @j NVARCHAR(MAX) = (
  SELECT PRODUCT_CODE AS productCode, RATE_TYPE AS rateType, PAGE AS page, RATE AS rate
  FROM dbo.ProposalProductTypeRS WHERE PROPOSAL_ID = '${esc(head.previousId)}'
  FOR JSON PATH);
SELECT ISNULL(@j, '[]');`,
    }) || '[]');
  }

  const footer = computeSummaryFooter({ payloadJson, prevRows });
  log(`[kit] footer: ${footer.perProduct.length} product(s) · baseline=${footer.baselineUsed}`);

  // per-section breakdown for the UI: section × product → current/latest
  const sectionKeys = new Set([
    ...Object.keys(footer.currentBySection),
    ...footer.latestBySection.map((x) => x.section),
  ]);
  const latestMap = new Map(footer.latestBySection.map((x) => [x.section, new Map(x.products.map((p) => [p.productId, p.value]))]));
  const sections = [...sectionKeys].map((section) => ({
    section,
    products: footer.perProduct.map(({ productId }) => ({
      productId,
      current: footer.currentBySection[section]?.[productId] ?? 0,
      latest: latestMap.get(section)?.get(productId) ?? 0,
    })),
  }));

  return {
    proposal: { id: head.id, requestNo: head.requestNo, version: head.version, previousId: head.previousId ?? null },
    footer,
    sections,
  };
}
