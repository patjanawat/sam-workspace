// Proposal Inspector — read-only X-ray of one proposal.
// Pure computation lives up top (unit-tested); SQL fetch + orchestration below.

import { assertDevDbServer } from './guard.mjs';
import { runSqlWide } from './db.mjs';

const GUID_RE = /^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$/;
const esc = (v) => String(v).replace(/'/g, "''");

export const STATUS_NAME = {
  0: 'Temp', 1: 'Draft', 2: 'Pending', 3: 'Approved', 4: 'Rejected', 5: 'Skipped',
  10: 'In-progress (sentinel)',
};
export const GROUP_LETTER = { 1: 'P', 2: 'R', 3: 'S' };

// SAM runs on Thailand time (UTC+7, no DST) — mirrors clone-proposal.mjs
function thaiNow(now = () => Date.now()) {
  const d = new Date(now() + 7 * 3600e3);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    date: d.toISOString().slice(0, 10),
  };
}

// ------------------------------------------------------------------ payload

// Parse one page's payload — DOUBLE-ENCODED JSON string in the real data
// (see json-contract.mjs); tolerate an already-decoded object.
function readPage(page) {
  if (!page || page.deleted === true) return null;
  let pp = page.payload;
  if (typeof pp === 'string') {
    try { pp = JSON.parse(pp); } catch { return null; }
  }
  if (!pp || Array.isArray(pp) || !Array.isArray(pp.products)) return null;
  return pp;
}

// Summarize a rebate/special/accum payload column: schemaVersion, page counts,
// unique productIds (active pages only), contract cell per product.
export function summarizePayload(json) {
  if (!json || typeof json !== 'string') return null;
  let doc;
  try { doc = JSON.parse(json); } catch { return null; }
  if (!doc || typeof doc !== 'object') return null;

  const pages = Array.isArray(doc.pages) ? doc.pages : [doc]; // flat = single page
  let activePages = 0;
  let deletedPages = 0;
  const productIds = [];
  const contracts = [];
  for (const page of pages) {
    if (page && page.deleted === true) { deletedPages++; continue; }
    // page with a payload wrapper (real shape) or a flat page-payload itself
    const pp = ('payload' in (page ?? {})) ? readPage(page) : (Array.isArray(page?.products) ? page : null);
    if (!pp) continue;
    activePages++;
    pp.products.forEach((prod, i) => {
      const pid = String(prod?.productId ?? '').trim();
      if (pid && !productIds.includes(pid)) productIds.push(pid);
      const colId = (prod && typeof prod.colId === 'string' && prod.colId) ? prod.colId : `col-${i + 1}`;
      const cell = pp.values?.contract?.[colId];
      if (cell && !contracts.some((c) => c.productId === pid)) {
        contracts.push({ productId: pid, colId, value: cell.new ?? '' });
      }
    });
  }
  if (!activePages && !deletedPages) return null;
  return { schemaVersion: doc.schemaVersion ?? null, activePages, deletedPages, productIds, contracts };
}

// ------------------------------------------------------------------ lineage

// Order PreviousId-chain rows root → … → current → descendants and flag the
// current node. Rows come from a recursive CTE (both directions), unordered.
// Branches (several clones of one source) are flattened in version order.
export function orderLineage(rows, currentId) {
  const byId = new Map(rows.map((r) => [r.id, r]));

  // walk up from current to the first known ancestor
  const ancestors = [];
  let node = byId.get(currentId);
  while (node) {
    ancestors.unshift(node);
    node = node.previousId ? byId.get(node.previousId) : undefined;
  }

  // walk down breadth-first, children sorted by version
  const chain = [...ancestors];
  const seen = new Set(chain.map((r) => r.id));
  let frontier = [currentId];
  while (frontier.length) {
    const children = rows
      .filter((r) => frontier.includes(r.previousId) && !seen.has(r.id))
      .sort((a, b) => a.version - b.version);
    children.forEach((c) => { chain.push(c); seen.add(c.id); });
    frontier = children.map((c) => c.id);
  }

  return chain.map((r) => ({ ...r, current: r.id === currentId }));
}

// --------------------------------------------------------------- step ------

export const APPROVAL_CHAIN = ['sam', 'sdm', 'pte', 'cdr'];
// ApprovalAction values (Shared/Enums/ApprovalStatus.cs)
const ACT_APPROVED = 3;
const ACT_REJECTED = 4;
const ACT_SKIPPED = 5;

// Derive the current approval step from history rows + ProposalStatus.
// A role is "done" when it has an Approved/Skipped row — bypass and delegate
// rows carry action=Approved too, so they count naturally.
export function deriveCurrentStep(history, proposalStatus) {
  if (proposalStatus === 0 || proposalStatus === 1) return { state: 'not-submitted', nextRole: null };
  if (proposalStatus === 3) return { state: 'approved', nextRole: null };
  if (proposalStatus === 4) {
    const rej = history.find((h) => h.action === ACT_REJECTED);
    return { state: 'rejected', nextRole: null, rejectedBy: rej ? rej.roleCode : null };
  }
  const done = new Set(
    history.filter((h) => h.action === ACT_APPROVED || h.action === ACT_SKIPPED).map((h) => h.roleCode),
  );
  const nextRole = APPROVAL_CHAIN.find((r) => !done.has(r)) ?? null;
  return { state: proposalStatus === 10 ? 'blocked' : 'pending', nextRole };
}

// ------------------------------------------------------- who can approve ---

const inRange = (d, from, to) => Boolean(from && to && from <= d && d <= to);

// For the current step, work out who can actually press approve today and why
// others can't: lockout, inactive, active delegation (actor moves to the
// delegate target), sam-track ownership (GetApprovalByIdHandler: creator or
// creator's direct manager only), and the SDM auto-delegate rule (ALL SDM
// users delegating → the step auto-approves, nobody needs to act).
export function computeWhoCanApprove({ step, roleUsers, delegates, creator, today }) {
  if (!step.nextRole) return { rows: [], sdmAutoDelegate: false };

  const activeDelegateOf = (userId) =>
    delegates.find((d) => d.userId === userId && inRange(today, d.fromDate, d.toDate));

  const rows = roleUsers.map((u) => {
    const reasons = [];
    let delegatedTo = null;
    if (!u.isActive) reasons.push('inactive account');
    if (u.isLock) reasons.push('locked out');
    const del = activeDelegateOf(u.id);
    if (del) {
      delegatedTo = del.delegateToName;
      reasons.push(`delegating to ${del.delegateToName} (${del.fromDate} → ${del.toDate})`);
    }
    if (step.nextRole === 'sam' && creator.id !== u.id && creator.reportToId !== u.id) {
      reasons.push('sam-track ownership: not the creator or their direct manager — detail GET returns 403');
    }
    return { id: u.id, name: u.name, email: u.email, eligible: reasons.length === 0, reasons, delegatedTo };
  });

  const sdmAutoDelegate =
    step.nextRole === 'sdm' &&
    roleUsers.length > 0 &&
    roleUsers.every((u) => activeDelegateOf(u.id));

  return { rows, sdmAutoDelegate };
}

// -------------------------------------------------------------- diagnosis --

const period = (y, m) => y * 100 + m;

// Automated stuck-checks. Every check always reports (ok/warn/err) so the
// reader can see what was ruled out, not just what fired.
export function runDiagnosis({ proposal, closedPeriods, cgConflicts, today }) {
  const p = proposal;
  const checks = [];
  const add = (id, level, detail) => checks.push({ id, level, detail });

  if (p.status === 10) {
    add('sentinel-10', 'err',
      'ProposalStatus=10 — in-progress sentinel stuck (approve died before commit). ' +
      'Approve gate only updates rows at status=2, so every retry reports "already processed". ' +
      'Reset the row to Pending(2) via SQL, then re-run the step.');
  } else {
    add('sentinel-10', 'ok', 'not stuck — no in-progress sentinel');
  }

  add('temp-cleanup', p.status === 0 ? 'warn' : 'ok',
    p.status === 0
      ? 'Temp(0) — the Hangfire cleanup job deletes Temp proposals; do not rely on this id'
      : 'not Temp(0) — cleanup job will not touch it');

  const closed = closedPeriods.includes(period(p.year, p.month));
  if (closed) {
    const blocksSubmit = p.status === 0 || p.status === 1;
    add('close-month', blocksSubmit ? 'err' : 'warn',
      `${p.year}/${String(p.month).padStart(2, '0')} is CLOSED — ` +
      (blocksSubmit ? 'submit is blocked for this period' : 'edits for this period are locked; approval can still proceed'));
  } else {
    add('close-month', 'ok', `${p.year}/${String(p.month).padStart(2, '0')} open — CloseMonth has no lock for this period`);
  }

  if (p.status === 3 && p.sapStatus === 'fail') {
    add('sap-sync', 'err', 'SAPStatus=fail — SAP sync failed; use SAP fixup to force state or re-sync');
  } else if (p.status === 3 && !p.sapStatus) {
    add('sap-sync', 'warn', 'Approved but SAPStatus empty — CDR sync runs async (Hangfire job); still running or died');
  } else {
    add('sap-sync', 'ok', p.status === 3 ? `SAPStatus=${p.sapStatus}` : 'not Approved yet — SAP sync not expected');
  }

  if (cgConflicts.length) {
    const list = cgConflicts.map((c) => `${c.requestNo} v${c.version}`).join(', ');
    add('cg-conflict', 'warn',
      `CustomerGroup already has ${cgConflicts.length} other Draft/Pending in this period (${list}) — a new create/clone for this CG will be refused`);
  } else {
    add('cg-conflict', 'ok', 'no other Draft/Pending on this CustomerGroup in this period');
  }

  add('month-rule', period(p.year, p.month) < period(today.year, today.month) ? 'warn' : 'ok',
    period(p.year, p.month) < period(today.year, today.month)
      ? `source month ${p.year}/${String(p.month).padStart(2, '0')} is in the past — cannot clone into it (current/next month rule)`
      : 'month/year within the current/next-month rule');

  return checks;
}

// ----------------------------------------------------------- orchestration --

const jsonArr = (sql) => `SET NOCOUNT ON;
DECLARE @j NVARCHAR(MAX) = (${sql} FOR JSON PATH);
SELECT ISNULL(@j, '[]');`;
const jsonObj = (sql) => `SET NOCOUNT ON;
DECLARE @j NVARCHAR(MAX) = (${sql} FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
SELECT ISNULL(@j, '');`;

function headerSql(id) {
  return jsonObj(`SELECT TOP 1
    CONVERT(NVARCHAR(36), p.Id) AS id, CONVERT(NVARCHAR(36), p.PreviousId) AS previousId,
    p.RequestNo AS requestNo, p.Version AS version, p.ProposalGroupId AS groupId,
    p.ProposalStatus AS status, ISNULL(p.SAPStatus,'') AS sapStatus,
    p.[Year] AS [year], p.[Month] AS [month],
    CONVERT(NVARCHAR(36), p.CustomerGroupId) AS customerGroupId, p.CustomerGroupCode AS customerGroupCode,
    p.RegionName AS regionName, p.SaleOrgCode AS saleOrgCode, p.SaleOfficeCode AS saleOfficeCode,
    ISNULL(so.SAL_OFF_EN_NM,'') AS saleOfficeName,
    CONVERT(NVARCHAR(36), p.SaleId) AS creatorId, ISNULL(u.Name,'') AS creatorName,
    ISNULL(u.RoleCode,'') AS creatorRole, CONVERT(NVARCHAR(36), u.ReportToId) AS creatorReportTo,
    CONVERT(NVARCHAR(33), p.RequestDateUTC, 126) AS requestDate,
    CONVERT(NVARCHAR(33), p.ApprovalDateUTC, 126) AS approvalDate,
    la.Name AS lastApprovalName,
    CONVERT(NVARCHAR(10), p.StartDate, 23) AS startDate, CONVERT(NVARCHAR(10), p.EndDate, 23) AS endDate,
    '0x' + CONVERT(NVARCHAR(20), CONVERT(BIGINT, p.RowVersion)) AS rowVersion
  FROM dbo.Proposal p
  LEFT JOIN [identity].AspNetUsers u ON u.Id = p.SaleId
  LEFT JOIN [identity].AspNetUsers la ON la.Id = p.LastApprovalId
  LEFT JOIN core.SaleOffice so ON so.SAL_OFF_CODE = p.SaleOfficeCode
  WHERE p.Id = '${id}'`);
}

// PreviousId chain, both directions from the current row.
function lineageSql(id) {
  return `SET NOCOUNT ON;
WITH chain AS (
  SELECT p.Id, p.PreviousId, p.RequestNo, p.Version, p.ProposalStatus FROM dbo.Proposal p WHERE p.Id = '${id}'
  UNION ALL
  SELECT a.Id, a.PreviousId, a.RequestNo, a.Version, a.ProposalStatus FROM dbo.Proposal a JOIN chain c ON a.Id = c.PreviousId
), down AS (
  SELECT Id FROM chain
  UNION ALL
  SELECT d.Id FROM dbo.Proposal d JOIN down ON d.PreviousId = down.Id
)
SELECT (SELECT DISTINCT CONVERT(NVARCHAR(36), p.Id) AS id, CONVERT(NVARCHAR(36), p.PreviousId) AS previousId,
  p.RequestNo AS requestNo, p.Version AS version, p.ProposalStatus AS status
FROM dbo.Proposal p WHERE p.Id IN (SELECT Id FROM down) OR p.Id IN (SELECT Id FROM chain)
FOR JSON PATH);`;
}

function timelineSql(id) {
  return jsonArr(`SELECT
    ISNULL(r.Code,'') AS roleCode, ISNULL(r.Name,'') AS roleName, ISNULL(u.Name,'') AS approver,
    h.Action AS action, CONVERT(NVARCHAR(33), h.ActionDateUTC, 126) AS actionDate,
    h.Comment AS comment,
    CAST(h.IsDelegate AS INT) AS isDelegate, CAST(h.IsBypass AS INT) AS isBypass
  FROM dbo.ApprovalHistory h
  LEFT JOIN [identity].AspNetUsers u ON u.Id = h.ApproverId
  LEFT JOIN [identity].AspNetRoles r ON r.Id = h.ApproverRoleId
  WHERE h.ProposalId = '${id}'
  ORDER BY h.ActionDateUTC`);
}

const USERS_SQL = jsonArr(`SELECT CONVERT(NVARCHAR(36), Id) AS id, Name AS name, ISNULL(Email,'') AS email,
    RoleCode AS roleCode, CAST(IsActive AS INT) AS isActive,
    CASE WHEN LockoutEnd IS NOT NULL AND LockoutEnd > SYSUTCDATETIME() THEN 1 ELSE 0 END AS isLock
  FROM [identity].AspNetUsers WHERE IsDelete = 0 AND RoleCode IN ('sam','sdm','pte','cdr')`);

const DELEGATES_SQL = jsonArr(`SELECT CONVERT(NVARCHAR(36), UserId) AS userId,
    CONVERT(NVARCHAR(36), DelegateToId) AS delegateToId, ISNULL(DelegateToName,'') AS delegateToName,
    CONVERT(NVARCHAR(10), DelegateFromDate, 23) AS fromDate, CONVERT(NVARCHAR(10), DelegateToDate, 23) AS toDate
  FROM dbo.UserDelegate WHERE DelegateFromDate IS NOT NULL AND DelegateToDate IS NOT NULL`);

const CLOSED_SQL = jsonArr(`SELECT Period AS period FROM dbo.CloseMonth WHERE CloseMonthDate IS NOT NULL`);

function cgConflictSql(p) {
  return jsonArr(`SELECT RequestNo AS requestNo, Version AS version, ProposalStatus AS status
  FROM dbo.Proposal
  WHERE CustomerGroupId = '${esc(p.customerGroupId)}' AND [Year] = ${Number(p.year)} AND [Month] = ${Number(p.month)}
    AND ProposalStatus IN (1,2) AND Id <> '${esc(p.id)}'`);
}

function relatedSql(id) {
  return jsonObj(`SELECT
    (SELECT c.SOLDTO_CODE AS code, c.SOLDTO_NAME AS name FROM dbo.ProposalCustomer c WHERE c.PROPOSAL_ID = '${id}' FOR JSON PATH) AS customers,
    (SELECT pp.PRODUCT_CODE AS code, COUNT(*) AS rows
       FROM dbo.ProposalProduct pp WHERE pp.PROPOSAL_ID = '${id}' GROUP BY pp.PRODUCT_CODE FOR JSON PATH) AS products,
    (SELECT f.FileName AS name, f.FilePath AS path FROM dbo.ProposalFile f WHERE f.ProposalId = '${id}' FOR JSON PATH) AS files`);
}

export async function inspectProposal({ db, proposalId, readWide = runSqlWide, now, log = () => {} }) {
  if (!GUID_RE.test(proposalId || '')) throw new Error(`Invalid proposalId (must be GUID): ${proposalId}`);
  assertDevDbServer(db.server, db.allowedServers);
  const sam = { server: db.server, ...db.sam };
  const id = esc(proposalId);
  const today = thaiNow(now);

  log(`[kit] inspect ${proposalId}`);
  const headerJson = await readWide({ ...sam, sql: headerSql(id) });
  if (!headerJson || !headerJson.trim()) throw new Error('Proposal not found.');
  const p = JSON.parse(headerJson);
  log(`[kit] ${p.requestNo} v${p.version} — Type ${GROUP_LETTER[p.groupId] ?? p.groupId} · ${STATUS_NAME[p.status] ?? p.status}`);

  const [lineageRows, timeline, users, delegates, closedRows, cgConflicts] = await Promise.all([
    readWide({ ...sam, sql: lineageSql(id) }).then((j) => JSON.parse(j || '[]')),
    readWide({ ...sam, sql: timelineSql(id) }).then((j) => JSON.parse(j || '[]')),
    readWide({ ...sam, sql: USERS_SQL }).then((j) => JSON.parse(j || '[]')),
    readWide({ ...sam, sql: DELEGATES_SQL }).then((j) => JSON.parse(j || '[]')),
    readWide({ ...sam, sql: CLOSED_SQL }).then((j) => JSON.parse(j || '[]')),
    readWide({ ...sam, sql: cgConflictSql(p) }).then((j) => JSON.parse(j || '[]')),
  ]);

  const step = deriveCurrentStep(timeline, p.status);
  const who = computeWhoCanApprove({
    step,
    roleUsers: users.filter((u) => u.roleCode === step.nextRole).map((u) => ({ ...u, isActive: Boolean(u.isActive), isLock: Boolean(u.isLock) })),
    delegates,
    creator: { id: p.creatorId, reportToId: p.creatorReportTo },
    today: today.date,
  });
  const diagnosis = runDiagnosis({
    proposal: p,
    closedPeriods: closedRows.map((r) => r.period),
    cgConflicts,
    today,
  });

  const payloadOf = async (col) => summarizePayload(
    await readWide({ ...sam, sql: `SET NOCOUNT ON; SELECT ${col} FROM dbo.ProposalDetail WHERE ProposalId='${id}';` }),
  );
  const payloads = {
    rebate: await payloadOf('RebatePayload'),
    special: await payloadOf('SpecialPayload'),
    accum: await payloadOf('AccumPayload'),
  };

  const relatedJson = await readWide({ ...sam, sql: relatedSql(id) });
  const relatedRaw = relatedJson && relatedJson.trim() ? JSON.parse(relatedJson) : {};
  const related = {
    customers: relatedRaw.customers ?? [],
    products: relatedRaw.products ?? [],
    files: relatedRaw.files ?? [],
  };

  return {
    proposal: {
      ...p,
      statusName: STATUS_NAME[p.status] ?? String(p.status),
      typeLetter: GROUP_LETTER[p.groupId] ?? `#${p.groupId}`,
    },
    lineage: orderLineage(lineageRows, p.id),
    timeline: timeline.map((t) => ({ ...t, isDelegate: Boolean(t.isDelegate), isBypass: Boolean(t.isBypass) })),
    step,
    who,
    diagnosis,
    payloads,
    related,
  };
}
