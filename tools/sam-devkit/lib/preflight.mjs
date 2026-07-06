// Env Preflight — one-button check that an env is actually ready to exercise,
// composing state already surfaced by the other modules instead of
// duplicating their queries. Answers the README's "Dev-env prerequisites to
// verify before first run" checklist in one pass.

import { assertDevDbServer } from './guard.mjs';
import { runSqlWide } from './db.mjs';

// ------------------------------------------------------------------ logins --

// One login attempt per configured role — never retries (lockout guard).
export async function checkLogins(accounts, login) {
  const roles = Object.entries(accounts ?? {});
  const results = [];
  for (const [role, acct] of roles) {
    try {
      await login(role, acct);
      results.push({ role, ok: true });
    } catch (e) {
      results.push({ role, ok: false, error: e.message });
    }
  }
  return results;
}

// ---------------------------------------------------------------- reportTo --

// Full 4-step approve-through chain needs srp.ReportToId === the sam account
// (Module C prerequisite (a)); otherwise fall back to submitting as sam (b).
export function checkReportTo({ srpUser, samUser }) {
  if (!srpUser || !samUser) return { ok: null, detail: 'srp or sam account not found in DB — cannot verify' };
  const ok = srpUser.reportToId === samUser.id;
  return {
    ok,
    detail: ok
      ? 'srp reports to the configured sam — full 4-step chain available'
      : 'srp does not report to the configured sam — submit as sam instead (option b), sam-track GET stays untested',
  };
}

// ------------------------------------------------------------ clone source --

export function checkCloneSource(proposals) {
  const example = proposals.find((p) => p.status === 3);
  return example
    ? { ok: true, detail: `${example.requestNo} is Approved — usable as a clone source`, example }
    : { ok: false, detail: 'no Approved proposal found — Clone → Draft has nothing to copy from' };
}

// ---------------------------------------------------------------- options --

export function checkOptionsData(options) {
  const required = ['customers', 'saleOrganizations', 'proposalGroups'];
  const empty = required.filter((k) => !(options?.[k]?.length > 0));
  return empty.length
    ? { ok: false, detail: `/requests/options returned empty: ${empty.join(', ')} — master data not seeded` }
    : { ok: true, detail: '/requests/options dropdowns populated' };
}

// -------------------------------------------------------------- closeMonth --

export function checkCloseMonth({ period, closedPeriods }) {
  const closed = closedPeriods.includes(period);
  return closed
    ? { ok: false, detail: `period ${period} is CLOSED — create/submit blocked this month` }
    : { ok: true, detail: `period ${period} is open` };
}

// ----------------------------------------------------------- orchestration --

function thaiPeriod(now = () => Date.now()) {
  const d = new Date(now() + 7 * 3600e3);
  return d.getUTCFullYear() * 100 + (d.getUTCMonth() + 1);
}

const usersSql = (emails) => `SET NOCOUNT ON;
DECLARE @j NVARCHAR(MAX) = (
  SELECT CONVERT(NVARCHAR(36), Id) AS id, Email AS email, CONVERT(NVARCHAR(36), ReportToId) AS reportToId
  FROM [identity].AspNetUsers WHERE Email IN (${emails.map((e) => `'${e.replace(/'/g, "''")}'`).join(',')})
  FOR JSON PATH);
SELECT ISNULL(@j, '[]');`;

const approvedSql = `SET NOCOUNT ON;
DECLARE @j NVARCHAR(MAX) = (
  SELECT TOP 5 RequestNo AS requestNo, ProposalStatus AS status FROM dbo.Proposal
  WHERE ProposalStatus = 3 ORDER BY CreatedDateUTC DESC FOR JSON PATH);
SELECT ISNULL(@j, '[]');`;

const closedSql = `SET NOCOUNT ON;
DECLARE @j NVARCHAR(MAX) = (SELECT Period AS period FROM dbo.CloseMonth WHERE CloseMonthDate IS NOT NULL FOR JSON PATH);
SELECT ISNULL(@j, '[]');`;

export async function runPreflight({ db, cfg, login, apiGet, readWide = runSqlWide, now, log = () => {} }) {
  assertDevDbServer(db.server, db.allowedServers);
  const sam = { server: db.server, ...db.sam };

  log('[kit] preflight: logins');
  const logins = await checkLogins(cfg.roles, login);
  const loginsOk = logins.every((r) => r.ok);
  const checks = [{
    id: 'logins', ok: loginsOk,
    detail: loginsOk
      ? `all ${logins.length} configured role(s) logged in`
      : `failed: ${logins.filter((r) => !r.ok).map((r) => r.role).join(', ')}`,
    rows: logins,
  }];

  log('[kit] preflight: srp → sam reportTo');
  const emails = [cfg.roles?.srp?.email, cfg.roles?.sam?.email].filter(Boolean);
  const users = emails.length ? JSON.parse(await readWide({ ...sam, sql: usersSql(emails) }) || '[]') : [];
  const srpUser = users.find((u) => u.email === cfg.roles?.srp?.email) ?? null;
  const samUser = users.find((u) => u.email === cfg.roles?.sam?.email) ?? null;
  const reportTo = checkReportTo({ srpUser, samUser });
  checks.push({ id: 'report-to', ok: reportTo.ok, detail: reportTo.detail });

  log('[kit] preflight: clone source');
  const approved = JSON.parse(await readWide({ ...sam, sql: approvedSql }) || '[]');
  const cloneSource = checkCloneSource(approved);
  checks.push({ id: 'clone-source', ok: cloneSource.ok, detail: cloneSource.detail });

  log('[kit] preflight: /requests/options');
  let optionsCheck;
  try {
    const options = await apiGet('/requests/options');
    optionsCheck = checkOptionsData(options);
  } catch (e) {
    optionsCheck = { ok: false, detail: `/requests/options unreachable: ${e.message}` };
  }
  checks.push({ id: 'options-data', ok: optionsCheck.ok, detail: optionsCheck.detail });

  log('[kit] preflight: CloseMonth');
  const period = thaiPeriod(now);
  const closedRows = JSON.parse(await readWide({ ...sam, sql: closedSql }) || '[]');
  const closeMonth = checkCloseMonth({ period, closedPeriods: closedRows.map((r) => r.period) });
  checks.push({ id: 'close-month', ok: closeMonth.ok, detail: closeMonth.detail });

  const ready = checks.every((c) => c.ok !== false);
  log(`[kit] preflight: ${ready ? 'READY' : 'NOT READY'}`);
  return { ready, checks };
}
