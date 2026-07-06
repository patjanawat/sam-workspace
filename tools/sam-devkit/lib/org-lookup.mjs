// People & Permissions — org lookup (read-only) + the module's single write
// (account unlock). Answers: who is this user, who manages them, who reports
// to them, are they delegating today, are they locked out, what menus/actions
// can their role reach, and can they see a given proposal.

import { assertDevDbServer } from './guard.mjs';
import { runSql, runSqlWide } from './db.mjs';

const GUID_RE = /^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$/;
const esc = (v) => String(v).replace(/'/g, "''");
const escLike = (v) => esc(v).replace(/[[%_]/g, (c) => `[${c}]`);

// ---------------------------------------------------------------- org tree --

export function managerChain(users, userId) {
  const byId = new Map(users.map((u) => [u.id, u]));
  const chain = [];
  const seen = new Set();
  let node = byId.get(userId);
  while (node && !seen.has(node.id)) {
    chain.push(node);
    seen.add(node.id);
    node = node.reportToId ? byId.get(node.reportToId) : undefined;
  }
  return chain;
}

export function directReports(users, userId) {
  const direct = users.filter((u) => u.reportToId === userId);
  // indirect = everyone below the direct reports (breadth-first)
  let frontier = direct.map((u) => u.id);
  let indirectCount = 0;
  const seen = new Set(frontier);
  while (frontier.length) {
    const next = users.filter((u) => frontier.includes(u.reportToId) && !seen.has(u.id));
    indirectCount += next.length;
    next.forEach((u) => seen.add(u.id));
    frontier = next.map((u) => u.id);
  }
  return { direct, indirectCount };
}

// -------------------------------------------------------------- visibility --

// Role-based SQL visibility (logic lives in SQL, not C# — gotchas):
//   srp → own proposals only · sam → own + direct reports (ReportToId) ·
//   sdm/pte/cdr/adm/fin/adt → all. Sam-track detail GET has an EXTRA ownership
//   check for everyone: creator themselves or the creator's direct manager.
export function checkVisibility({ viewer, creator, users }) {
  const reasons = [];
  const isCreator = viewer.id === creator.id;
  const isDirectManager = creator.reportToId === viewer.id;

  let canSeeInList;
  if (viewer.roleCode === 'srp') {
    canSeeInList = isCreator;
    if (!canSeeInList) reasons.push('srp sees only own proposals (SQL @RoleCode filter)');
  } else if (viewer.roleCode === 'sam') {
    canSeeInList = isCreator || isDirectManager;
    if (!canSeeInList) reasons.push('sam sees own + direct reports only — creator\'s ReportToId is another sam');
  } else {
    canSeeInList = true;
  }

  const canOpenSamTrackDetail = isCreator || isDirectManager;
  if (!canOpenSamTrackDetail) {
    reasons.push('sam-track GET /approval/sam/{id} enforces ownership (creator or direct manager) → 403');
  }

  return {
    canSeeInList,
    canOpenSamTrackDetail,
    canOpenSdmTrackDetail: true, // /approval/sdm/{id} has no ownership check
    reasons,
  };
}

// ----------------------------------------------------------------- parsers --

// Extract ROLE_PERMISSIONS + ROLE_REDIRECTS from permissions.ts source text.
export function parsePermissionsTs(src) {
  const permissions = {};
  const redirects = {};

  const permsBlock = src.match(/ROLE_PERMISSIONS[^=]*=\s*\{([\s\S]*?)\n\};/);
  if (permsBlock) {
    const entryRe = /(\w+):\s*\[([\s\S]*?)\]/g;
    let m;
    while ((m = entryRe.exec(permsBlock[1]))) {
      permissions[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    }
  }
  const redirBlock = src.match(/ROLE_REDIRECTS[^=]*=\s*\{([\s\S]*?)\n\};/);
  if (redirBlock) {
    const entryRe = /(\w+):\s*'([^']+)'/g;
    let m;
    while ((m = entryRe.exec(redirBlock[1]))) redirects[m[1]] = m[2];
  }
  return { permissions, redirects };
}

// Extract AddPolicy("Name", ... RequireRole("A", "B")) pairs from Program.cs text.
export function parsePolicies(src) {
  const policies = {};
  const re = /AddPolicy\("([^"]+)"[\s\S]*?RequireRole\(([^)]*)\)/g;
  let m;
  while ((m = re.exec(src))) {
    policies[m[1]] = [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  }
  return policies;
}

// Role code ↔ ASP.NET role name (as used in Program.cs RequireRole)
export const CODE_TO_ROLE_NAME = {
  srp: 'Sales Representative',
  sam: 'Area Sales Manager',
  sdm: 'Sales Division Manager',
  pte: 'Pricing Team',
  cdr: 'Commercial Director',
  fin: 'Finance',
  adt: 'Auditor',
  sla: 'Sales Admin',
  adm: 'System Admin',
};

export function permissionMatrix({ roleCode, snapshot }) {
  const roleName = CODE_TO_ROLE_NAME[roleCode] ?? roleCode;
  return {
    roleCode,
    roleName,
    menus: snapshot.permissions[roleCode] ?? [],
    landing: snapshot.redirects[roleCode] ?? null,
    policies: Object.entries(snapshot.policies).map(([name, roles]) => ({
      name,
      roles,
      allowed: roles.includes(roleName),
    })),
  };
}

// ----------------------------------------------------------- orchestration --

const inRange = (d, from, to) => Boolean(from && to && from <= d && d <= to);

const USERS_SQL = `SET NOCOUNT ON;
DECLARE @j NVARCHAR(MAX) = (
  SELECT CONVERT(NVARCHAR(36), u.Id) AS id, u.Name AS name, ISNULL(u.Email,'') AS email,
    u.RoleCode AS roleCode, CONVERT(NVARCHAR(36), u.ReportToId) AS reportToId,
    CAST(u.IsActive AS INT) AS isActive,
    CASE WHEN u.LockoutEnd IS NOT NULL AND u.LockoutEnd > SYSUTCDATETIME() THEN 1 ELSE 0 END AS isLock,
    CONVERT(NVARCHAR(33), u.LockoutEnd, 126) AS lockoutEnd,
    ISNULL(u.SaleOfficeCode,'') AS saleOfficeCode, ISNULL(so.SAL_OFF_EN_NM,'') AS saleOfficeName,
    ISNULL(u.SaleGroupCode,'') AS saleGroupCode
  FROM [identity].AspNetUsers u
  LEFT JOIN core.SaleOffice so ON so.SAL_OFF_CODE = u.SaleOfficeCode
  WHERE u.IsDelete = 0
  FOR JSON PATH);
SELECT ISNULL(@j, '[]');`;

const DELEGATES_SQL = `SET NOCOUNT ON;
DECLARE @j NVARCHAR(MAX) = (
  SELECT CONVERT(NVARCHAR(36), UserId) AS userId,
    CONVERT(NVARCHAR(36), DelegateToId) AS delegateToId, ISNULL(DelegateToName,'') AS delegateToName,
    CONVERT(NVARCHAR(10), DelegateFromDate, 23) AS fromDate, CONVERT(NVARCHAR(10), DelegateToDate, 23) AS toDate
  FROM dbo.UserDelegate WHERE DelegateFromDate IS NOT NULL AND DelegateToDate IS NOT NULL
  FOR JSON PATH);
SELECT ISNULL(@j, '[]');`;

function thaiDate(now = () => Date.now()) {
  return new Date(now() + 7 * 3600e3).toISOString().slice(0, 10);
}

export async function orgLookup({ db, query, readWide = runSqlWide, now, log = () => {} }) {
  const term = String(query || '').trim();
  if (term.length < 2) throw new Error('search term too short (min 2 chars)');
  assertDevDbServer(db.server, db.allowedServers);
  const sam = { server: db.server, ...db.sam };

  log(`[kit] org lookup "${term}"`);
  const users = JSON.parse(await readWide({ ...sam, sql: USERS_SQL }) || '[]')
    .map((u) => ({ ...u, isActive: Boolean(u.isActive), isLock: Boolean(u.isLock) }));

  const t = term.toLowerCase();
  const user =
    users.find((u) => u.email.toLowerCase() === t) ||
    users.find((u) => u.email.toLowerCase().includes(t)) ||
    users.find((u) => (u.name || '').toLowerCase().includes(t));
  if (!user) throw new Error(`no user matches "${term}"`);
  log(`[kit] found ${user.name} <${user.email}> — ${user.roleCode}`);

  const delegates = JSON.parse(await readWide({ ...sam, sql: DELEGATES_SQL }) || '[]');
  const today = thaiDate(now);
  const chain = managerChain(users, user.id);
  const reports = directReports(users, user.id);
  const chainIds = new Set([...chain.map((u) => u.id), ...reports.direct.map((u) => u.id)]);
  const delegatesActive = delegates.filter((d) => inRange(today, d.fromDate, d.toDate) && chainIds.has(d.userId));
  const delegatedToUser = delegates.filter((d) => inRange(today, d.fromDate, d.toDate) && d.delegateToId === user.id);

  return {
    user,
    managerChain: chain,
    reports,
    delegatesActive,
    delegatedToUser,
    today,
  };
}

// The module's only write: clear lockout so a dev account can log in again.
export async function unlockUser({ db, userId, run = runSql, log = () => {} }) {
  if (!GUID_RE.test(userId || '')) throw new Error(`Invalid userId (must be GUID): ${userId}`);
  assertDevDbServer(db.server, db.allowedServers);
  const sam = { server: db.server, ...db.sam };
  log(`[kit] unlock user ${userId}`);
  const out = await run({
    ...sam,
    sql: `SET NOCOUNT ON; UPDATE AspNetUsers SET LockoutEnd = NULL, AccessFailedCount = 0 WHERE Id='${esc(userId)}'; SELECT @@ROWCOUNT;`,
  });
  const rows = Number(String(out).trim()) || 0;
  log(`[kit]   rows affected: ${rows}`);
  return { rows };
}
