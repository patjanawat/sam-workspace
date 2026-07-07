// SAP Sync Inspector — read-only compare of main DB Proposal.SAPStatus vs the
// SAP staging tables, decoding the per-flow success indicator (gotcha: the
// success VALUE differs by flow — never assume one applies to all three).
// Companion to SAP fixup (lib/sap-fixup.mjs), which writes; this only reads.

import { assertDevDbServer } from './guard.mjs';
import { runSqlWide } from './db.mjs';

const GUID_RE = /^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$/;
const esc = (v) => String(v).replace(/'/g, "''");

// ProposalGroupId letter → staging flow (ResendSapSyncListCommandHandler.cs)
export const FLOW_BY_TYPE = { R: 'CreateDiscount', P: 'CreateContract', S: 'ChangeContract' };
export const GROUP_LETTER = { 1: 'P', 2: 'R', 3: 'S' };

// SAP_RETURN success value per flow — NOT interchangeable across flows.
export const SUCCESS_VALUE = { CreateDiscount: '0', CreateContract: 'C', ChangeContract: 'S' };
export const TABLE_BY_FLOW = { CreateDiscount: 'CreateDiscount', CreateContract: 'CreateContract', ChangeContract: 'ChangeContract' };

export function decodeIndicator(flow, sapReturn) {
  if (!(flow in SUCCESS_VALUE)) throw new Error(`Unknown SAP flow "${flow}"`);
  return { success: sapReturn === SUCCESS_VALUE[flow], value: sapReturn ?? null, expected: SUCCESS_VALUE[flow] };
}

// ---------------------------------------------------------------- compare --

export function compareSapState({ type, mainSapStatus, period, stagingRows }) {
  const flow = FLOW_BY_TYPE[type];
  const thisPeriod = stagingRows.filter((r) => r.period === period);
  const rows = thisPeriod.map((r) => ({
    ...decodeIndicator(flow, r.sapReturn),
    docNo: r.docNo,
    message: r.sapMessage || null,
    contractNo: r.contractNo ?? null,
    processedAt: r.processedAt ?? null,
  }));
  const anySuccess = rows.some((r) => r.success);

  if (mainSapStatus === 'success') {
    if (!thisPeriod.length) return { level: 'err', detail: `Proposal.SAPStatus=success but no staging row found for period ${period} — sync never landed or wrong period`, rows };
    if (!anySuccess) return { level: 'err', detail: `Proposal.SAPStatus=success but staging shows fail (SAP_RETURN=${rows.map((r) => r.value).join(',')}) — main/staging disagree`, rows };
    const missingContract = (type === 'P' || type === 'S') && rows.some((r) => r.success && !r.contractNo);
    if (missingContract) return { level: 'warn', detail: 'synced successfully but no contract number written to staging', rows };
    return { level: 'ok', detail: `main=success, staging=success (${flow}.SAP_RETURN='${SUCCESS_VALUE[flow]}')`, rows };
  }

  if (mainSapStatus === 'fail') {
    return { level: 'ok', detail: `main=fail — expected state${thisPeriod.length ? ` (staging SAP_RETURN=${rows.map((r) => r.value).join(',')})` : ' (no staging row)'}`, rows };
  }

  // main empty — not yet synced
  if (!thisPeriod.length) return { level: 'warn', detail: 'SAPStatus not set and no staging row — sync pending or not yet triggered', rows };
  return { level: 'warn', detail: 'SAPStatus not set on main DB, but a staging row already exists — check for a stuck update', rows };
}

// ----------------------------------------------------------- orchestration --

export async function sapInspect({ db, proposalId, readWide = runSqlWide, log = () => {} }) {
  if (!GUID_RE.test(proposalId || '')) throw new Error(`Invalid proposalId (must be GUID): ${proposalId}`);
  assertDevDbServer(db.server, db.allowedServers);
  const sam = { server: db.server, ...db.sam };
  const sap = { server: db.server, ...db.sap };
  const id = esc(proposalId);

  const headJson = await readWide({
    ...sam,
    sql: `SET NOCOUNT ON;
DECLARE @j NVARCHAR(MAX) = (
  SELECT TOP 1 CONVERT(NVARCHAR(36), Id) AS id, ProposalGroupId AS groupId, ISNULL(SAPStatus,'') AS sapStatus,
    [Year] AS [year], [Month] AS [month], RequestNo AS requestNo, Version AS version
  FROM dbo.Proposal WHERE Id = '${id}'
  FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
SELECT ISNULL(@j, '');`,
  });
  if (!headJson || !headJson.trim()) throw new Error('Proposal not found.');
  const head = JSON.parse(headJson);
  const type = GROUP_LETTER[head.groupId];
  if (!type) throw new Error(`Unknown ProposalGroupId=${head.groupId}`);
  const flow = FLOW_BY_TYPE[type];
  const table = TABLE_BY_FLOW[flow];
  const period = head.year * 100 + head.month;
  log(`[kit] sap-sync x-ray ${head.requestNo} v${head.version} — Type ${type} → ${flow} · period ${period}`);

  const contractCol = type === 'P' ? 'SAP_CONTRACT_NO' : type === 'S' ? 'CONTRACT_NO' : null;
  const stagingJson = await readWide({
    ...sap,
    sql: `SET NOCOUNT ON;
DECLARE @j NVARCHAR(MAX) = (
  SELECT CONVERT(NVARCHAR(36), ID) AS id, DOCNO AS docNo, PERIOD AS period,
    ISNULL(SAP_RETURN,'') AS sapReturn, SAP_MESSAGE AS sapMessage,
    ${contractCol ? `${contractCol} AS contractNo,` : ''}
    CONVERT(NVARCHAR(33), PROCESSED_AT, 126) AS processedAt
  FROM dbo.${table} WHERE PROPOSAL_ID = '${id}'
  FOR JSON PATH);
SELECT ISNULL(@j, '[]');`,
  });
  const stagingRows = JSON.parse(stagingJson || '[]');
  log(`[kit] staging rows: ${stagingRows.length}`);

  const comparison = compareSapState({ type, mainSapStatus: head.sapStatus, period, stagingRows });
  log(`[kit] ${comparison.level}: ${comparison.detail}`);

  return {
    proposal: { id: head.id, requestNo: head.requestNo, version: head.version, groupId: head.groupId, sapStatus: head.sapStatus, period },
    type,
    flow,
    table,
    comparison,
  };
}
