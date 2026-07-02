import { randomUUID } from 'node:crypto';
import { assertDevDbServer } from './guard.mjs';
import { runSql, runSqlFile, runSqlWide } from './db.mjs';
import { writeTempSql } from './temp-sql.mjs';

const GUID_RE = /^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$/;
const REQNO_RE = /^[A-Za-z0-9\-/]{3,30}$/;
const MODES = new Set(['new-version', 'new-proposal']);

// whitelist — table/pk/fk names are never taken from user input
const GROUP_LETTER = { 1: 'P', 2: 'R', 3: 'S' };
const ORG_INITIAL = { S854: 'J', S899: 'A' }; // mirrors RequestNoGeneratorService.GetInitialLetter
const CHILD_TABLES = [
  { table: 'ProposalDetail', pk: 'Id', fk: 'ProposalId' },
  { table: 'ProposalCustomer', pk: 'ID', fk: 'PROPOSAL_ID' },
  { table: 'ProposalProduct', pk: 'ID', fk: 'PROPOSAL_ID' },
  { table: 'ProposalProductTypeP', pk: 'ID', fk: 'PROPOSAL_ID' },
  { table: 'ProposalProductTypeRS', pk: 'ID', fk: 'PROPOSAL_ID' },
  { table: 'ProposalFile', pk: 'Id', fk: 'ProposalId' },
];
// Proposal columns replaced with new values instead of copied from the source row
const PROPOSAL_OVERRIDES = ['Id', 'RequestNo', 'Version', 'ProposalStatus', 'PreviousId', 'RequestDateUTC', 'CreatedDateUTC', 'Year', 'Month', 'SAPStatus'];

const esc = (v) => String(v).replace(/'/g, "''");
const escLike = (v) => esc(v).replace(/[[%_]/g, (c) => `[${c}]`);
const scalar = (out) => Number(String(out).trim()) || 0;

// SAM runs on Thailand time (UTC+7, no DST) — month/year decisions follow it, like the BE.
function thaiToday(now = () => Date.now()) {
  const d = new Date(now() + 7 * 3600e3);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}
function nextMonth({ year, month }) {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

export async function searchProposals({ db, requestNo, readWide = runSqlWide, log = () => {} }) {
  const term = String(requestNo || '').trim();
  if (term.length < 2) throw new Error('search term too short (min 2 chars)');
  if (!/^[A-Za-z0-9\-/]+$/.test(term)) throw new Error(`Invalid search term "${term}"`);
  assertDevDbServer(db.server, db.allowedServers);

  const sam = { server: db.server, ...db.sam };
  log(`[kit] search Proposal.RequestNo like %${term}%`);
  const sql = `SET NOCOUNT ON;
DECLARE @j NVARCHAR(MAX) = (
  SELECT TOP 20
    CONVERT(NVARCHAR(36), p.Id) AS id, p.RequestNo AS requestNo, p.Version AS version,
    p.ProposalGroupId AS groupId, p.ProposalStatus AS status, ISNULL(p.SAPStatus,'') AS sapStatus,
    p.[Year] AS [year], p.[Month] AS [month], p.CustomerGroupCode AS customerGroup,
    CONVERT(NVARCHAR(36), p.PreviousId) AS previousId
  FROM dbo.Proposal p
  WHERE p.RequestNo LIKE '%${escLike(term)}%'
  ORDER BY p.RequestNo, p.Version DESC
  FOR JSON PATH);
SELECT ISNULL(@j, '[]');`;
  const out = await readWide({ ...sam, sql });
  const proposals = JSON.parse(out || '[]');
  log(`[kit] found ${proposals.length} proposal${proposals.length === 1 ? '' : 's'}`);
  return { proposals };
}

// Replicates RequestNoGeneratorService: {orgInitial}-{saleOffice}-{groupLetter}{yy}{run:5} with
// yy = Thai-timezone CE year % 100 and run = MAX(existing 5-digit tail under the prefix) + 1.
export async function generateRequestNo({ db, source, run = runSql, now, log = () => {} }) {
  const letter = ORG_INITIAL[source.saleOrgCode] || 'X';
  const groupLetter = GROUP_LETTER[source.groupId];
  if (!groupLetter) throw new Error(`Unknown ProposalGroupId=${source.groupId}`);
  const yy = String(thaiToday(now).year % 100).padStart(2, '0');
  const prefix = `${letter}-${source.saleOfficeCode}-${groupLetter}${yy}`;

  const sam = { server: db.server, ...db.sam };
  const out = await run({
    ...sam,
    sql: `SET NOCOUNT ON; SELECT ISNULL(MAX(CAST(SUBSTRING(RequestNo, ${prefix.length + 1}, 5) AS INT)), 0)
FROM dbo.Proposal
WHERE RequestNo LIKE '${escLike(prefix)}[0-9][0-9][0-9][0-9][0-9]' AND LEN(RequestNo) = ${prefix.length + 5};`,
  });
  const next = scalar(out) + 1;
  const requestNo = `${prefix}${String(next).padStart(5, '0')}`;
  log(`[kit] generated RequestNo ${requestNo} (prefix ${prefix}, running ${next})`);
  return requestNo;
}

function buildCloneSql({ sourceId, newId, requestNo, version, year, month }) {
  const overrideList = PROPOSAL_OVERRIDES.map((c) => `[${c}]`).join(',');
  const overrideNames = PROPOSAL_OVERRIDES.map((c) => `'${c}'`).join(',');
  const lines = [
    'SET NOCOUNT ON;',
    'SET XACT_ABORT ON;',
    'BEGIN TRAN;',
    `DECLARE @src UNIQUEIDENTIFIER = '${esc(sourceId)}';`,
    `DECLARE @new UNIQUEIDENTIFIER = '${esc(newId)}';`,
    'DECLARE @cols NVARCHAR(MAX), @sql NVARCHAR(MAX);',
    'DECLARE @counts TABLE (tbl SYSNAME, cnt INT);',
    '',
    '-- Proposal: copy every real column except the overridden ones (RowVersion/computed auto-excluded)',
    `SELECT @cols = STRING_AGG(CONVERT(NVARCHAR(MAX), QUOTENAME(c.name)), ',')
FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
WHERE c.object_id = OBJECT_ID('dbo.Proposal') AND c.is_computed = 0 AND c.is_identity = 0
  AND t.name NOT IN ('timestamp','rowversion') AND c.name NOT IN (${overrideNames});`,
    `SET @sql = N'INSERT INTO dbo.Proposal (${overrideList},' + @cols + ')
SELECT @new, N''${esc(requestNo)}'', ${Number(version)}, 1, @src, GETUTCDATE(), GETUTCDATE(), ${Number(year)}, ${Number(month)}, N'''', ' + @cols + '
FROM dbo.Proposal WHERE Id = @src';`,
    "EXEC sp_executesql @sql, N'@new UNIQUEIDENTIFIER, @src UNIQUEIDENTIFIER', @new=@new, @src=@src;",
    "INSERT INTO @counts VALUES ('Proposal', @@ROWCOUNT);",
  ];
  for (const { table, pk, fk } of CHILD_TABLES) {
    lines.push(
      '',
      `-- ${table}`,
      `SET @cols = NULL;
SELECT @cols = STRING_AGG(CONVERT(NVARCHAR(MAX), QUOTENAME(c.name)), ',')
FROM sys.columns c JOIN sys.types t ON c.user_type_id = t.user_type_id
WHERE c.object_id = OBJECT_ID('dbo.${table}') AND c.is_computed = 0 AND c.is_identity = 0
  AND t.name NOT IN ('timestamp','rowversion') AND c.name NOT IN ('${pk}','${fk}');`,
      `SET @sql = N'INSERT INTO dbo.${table} ([${pk}],[${fk}],' + @cols + ')
SELECT NEWID(), @new, ' + @cols + ' FROM dbo.${table} WHERE [${fk}] = @src';`,
      "EXEC sp_executesql @sql, N'@new UNIQUEIDENTIFIER, @src UNIQUEIDENTIFIER', @new=@new, @src=@src;",
      `INSERT INTO @counts VALUES ('${table}', @@ROWCOUNT);`,
    );
  }
  lines.push('', 'COMMIT;', "SELECT tbl + ':' + CONVERT(VARCHAR(12), cnt) FROM @counts;");
  return lines.join('\n');
}

function parseCounts(out) {
  const copied = {};
  for (const line of String(out).split('\n')) {
    const m = line.trim().match(/^(\w+):(\d+)$/);
    if (m) copied[m[1]] = Number(m[2]);
  }
  return copied;
}

export async function cloneProposal({
  db, sourceId, mode, newRequestNo,
  run = runSql, runFile = runSqlFile, readWide = runSqlWide, writeTemp = writeTempSql, now, log = () => {},
}) {
  if (!GUID_RE.test(sourceId || '')) throw new Error(`Invalid sourceId (must be GUID): ${sourceId}`);
  if (!MODES.has(mode)) throw new Error(`Invalid mode "${mode}" (expected new-version or new-proposal)`);
  const typedReqNo = (newRequestNo || '').trim();
  if (typedReqNo && !REQNO_RE.test(typedReqNo)) throw new Error(`Invalid newRequestNo "${typedReqNo}"`);

  assertDevDbServer(db.server, db.allowedServers);
  const sam = { server: db.server, ...db.sam };
  const id = esc(sourceId);

  // 1) fetch source
  log(`[kit] fetch source ${sourceId}`);
  const srcJson = await readWide({
    ...sam,
    sql: `SET NOCOUNT ON;
DECLARE @j NVARCHAR(MAX) = (
  SELECT TOP 1 CONVERT(NVARCHAR(36), Id) AS id, RequestNo AS requestNo, Version AS version,
    ProposalGroupId AS groupId, ProposalStatus AS status, ISNULL(SAPStatus,'') AS sapStatus,
    SaleOrgCode AS saleOrgCode, SaleOfficeCode AS saleOfficeCode
  FROM dbo.Proposal WHERE Id = '${id}'
  FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
SELECT ISNULL(@j, '');`,
  });
  if (!srcJson || !srcJson.trim()) throw new Error('Source proposal not found.');
  const source = JSON.parse(srcJson);
  const groupLetter = GROUP_LETTER[source.groupId] || `#${source.groupId}`;
  log(`[kit] source ${source.requestNo} v${source.version} — Type ${groupLetter} · status=${source.status} · SAP=${source.sapStatus || '—'}`);

  // 2) guards + warnings
  if (mode === 'new-proposal' && source.groupId === 1) {
    throw new Error('Type P must clone to a new version (same RequestNo) — new-proposal not allowed.');
  }
  const warnings = [];
  if (source.status !== 3) {
    warnings.push(`source is not Approved (status=${source.status}) — cloning anyway`);
    log('[kit] WARN source not Approved — cloning anyway');
  }
  if (source.groupId === 1 && source.sapStatus !== 'success') {
    warnings.push(`Type P source without SAPStatus=success (got "${source.sapStatus}")`);
    log('[kit] WARN Type P source without SAPStatus=success');
  }

  // 3) resolve target — month follows the mode: new-version = current month, new-proposal = current + 1
  const today = thaiToday(now);
  let requestNo, version, ym;
  if (mode === 'new-version') {
    requestNo = source.requestNo;
    const maxOut = await run({ ...sam, sql: `SET NOCOUNT ON; SELECT ISNULL(MAX(Version), 0) FROM dbo.Proposal WHERE RequestNo = '${esc(requestNo)}';` });
    version = scalar(maxOut) + 1;
    ym = today;
  } else {
    requestNo = typedReqNo || await generateRequestNo({ db, source, run, now, log });
    version = 0;
    ym = nextMonth(today);
  }
  log(`[kit] target ${requestNo} v${version} — Draft · ${ym.year}/${String(ym.month).padStart(2, '0')} (${mode})`);

  // 4) uniqueness
  const dupOut = await run({ ...sam, sql: `SET NOCOUNT ON; SELECT COUNT(*) FROM dbo.Proposal WHERE RequestNo = '${esc(requestNo)}' AND Version = ${Number(version)};` });
  if (scalar(dupOut) > 0) throw new Error(`RequestNo ${requestNo} v${version} already exists.`);

  // 5) clone in one transactional batch (dynamic column lists — schema drift safe)
  const newId = randomUUID();
  const sql = buildCloneSql({ sourceId, newId, requestNo, version, year: ym.year, month: ym.month });
  const tmp = await writeTemp(sql);
  let copied;
  try {
    log(`[kit] INSERT Proposal ${newId} (Status=Draft, PreviousId=${sourceId.slice(0, 8)}…, SAPStatus reset) + copy children`);
    copied = parseCounts(await runFile({ ...sam, file: tmp.path }));
  } finally {
    await tmp.cleanup();
  }
  for (const { table } of CHILD_TABLES) {
    log(`[kit]   ${table} — ${copied[table] ?? 0} row${(copied[table] ?? 0) === 1 ? '' : 's'}`);
  }

  return {
    newId,
    requestNo,
    version,
    mode,
    year: ym.year,
    month: ym.month,
    status: 'Draft',
    source: { id: source.id, requestNo: source.requestNo, version: source.version, groupId: source.groupId },
    warnings,
    copied,
  };
}
