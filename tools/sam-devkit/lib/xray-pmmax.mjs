// Screen X-ray: Rebate › P.M. Max per-page — compares the pmLastStep meta
// STORED in the saved payload against what the BE would inject today
// (InjectPmMaxBaseline: same reindexed page → its baseline; added page or no
// counterpart → page-1 fallback). A mismatch = stale/corrupted baseline meta,
// the SAM-1810 family of bugs.

import { assertDevDbServer } from './guard.mjs';
import { runSqlWide } from './db.mjs';
import { buildBaseline, reindexPages, parsePages } from './xray-summary.mjs';

const GUID_RE = /^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$/;
const esc = (v) => String(v).replace(/'/g, "''");

export function computePmMaxRows({ payloadJson, prevRows }) {
  const pages = parsePages(payloadJson);
  const hasPrev = Array.isArray(prevRows) && prevRows.length > 0;
  let reindexed = { baseline: {}, discountByPage: {} };
  if (hasPrev) {
    const { baseline, discountByPage } = buildBaseline(prevRows);
    reindexed = reindexPages(baseline, discountByPage);
  }
  const page1 = reindexed.baseline[1] ?? {};

  const rows = [];
  for (const page of pages) {
    if (page.deleted) continue;
    // added page, or page number missing from the baseline → page-1 fallback
    const counterpart = reindexed.baseline[page.pageNumber];
    const addedPage = page.isAddedPage || (hasPrev && !counterpart);
    const pageBaseline = addedPage ? page1 : (counterpart ?? {});

    for (const s of page.sections) {
      if (!s?.section || s.section === 'discountHeader') continue;
      const stored = new Map((s.meta?.pmLastStep ?? []).map((x) => [x.productId, Number(x.value) || 0]));
      const expected = hasPrev ? (pageBaseline[s.section] ?? {}) : null;
      const productIds = new Set([...stored.keys(), ...Object.keys(expected ?? {})]);
      for (const productId of productIds) {
        const st = stored.has(productId) ? stored.get(productId) : null;
        const ex = expected === null ? null : (expected[productId] ?? null);
        rows.push({
          page: page.pageNumber,
          section: s.section,
          productId,
          stored: st,
          expected: ex,
          addedPage,
          match: expected === null ? null : st === ex,
        });
      }
    }
  }
  return rows;
}

export async function xrayPmMax({ db, proposalId, readWide = runSqlWide, log = () => {} }) {
  if (!GUID_RE.test(proposalId || '')) throw new Error(`Invalid proposalId (must be GUID): ${proposalId}`);
  assertDevDbServer(db.server, db.allowedServers);
  const sam = { server: db.server, ...db.sam };
  const id = esc(proposalId);

  const headJson = await readWide({
    ...sam,
    sql: `SET NOCOUNT ON;
DECLARE @j NVARCHAR(MAX) = (
  SELECT TOP 1 CONVERT(NVARCHAR(36), Id) AS id, CONVERT(NVARCHAR(36), PreviousId) AS previousId,
    RequestNo AS requestNo, Version AS version
  FROM dbo.Proposal WHERE Id = '${id}'
  FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
SELECT ISNULL(@j, '');`,
  });
  if (!headJson || !headJson.trim()) throw new Error('Proposal not found.');
  const head = JSON.parse(headJson);

  const payloadJson = await readWide({
    ...sam,
    sql: `SET NOCOUNT ON; SELECT RebatePayload FROM dbo.ProposalDetail WHERE ProposalId='${id}';`,
  });
  const prevRows = head.previousId
    ? JSON.parse(await readWide({
        ...sam,
        sql: `SET NOCOUNT ON;
DECLARE @j NVARCHAR(MAX) = (
  SELECT PRODUCT_CODE AS productCode, RATE_TYPE AS rateType, PAGE AS page, RATE AS rate
  FROM dbo.ProposalProductTypeRS WHERE PROPOSAL_ID = '${esc(head.previousId)}'
  FOR JSON PATH);
SELECT ISNULL(@j, '[]');`,
      }) || '[]')
    : [];

  const rows = computePmMaxRows({ payloadJson, prevRows });
  const mismatches = rows.filter((r) => r.match === false).length;
  log(`[kit] pm-max x-ray ${head.requestNo} v${head.version} — ${rows.length} cells · ${mismatches} mismatch`
    + (head.previousId ? '' : ' (no PreviousId — nothing to compare)'));

  return {
    proposal: { id: head.id, requestNo: head.requestNo, version: head.version, previousId: head.previousId ?? null },
    rows,
    summary: { cells: rows.length, mismatches, comparable: Boolean(head.previousId) },
  };
}
