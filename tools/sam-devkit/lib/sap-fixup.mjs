import { assertDevDbServer } from './guard.mjs';
import { runSql, runSqlFile, runSqlWide } from './db.mjs';
import { upsertContractForAllProducts } from './json-contract.mjs';
import { writeTempSql } from './temp-sql.mjs';
import { mockStagingRow } from './sap-mock-staging.mjs';

const GUID_RE = /^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$/;
const STATUS_VALUES = new Set(['success', 'fail', '']);
const CONTRACT_RE = /^[A-Za-z0-9_\-/]{0,50}$/;

// whitelist — table/column names are never taken from user input
const CONTRACT_TABLE = {
  1: { table: 'CreateContract', col: 'SAP_CONTRACT_NO' }, // Type P
  3: { table: 'ChangeContract', col: 'CONTRACT_NO' },     // Type S
};

const esc = (v) => String(v).replace(/'/g, "''");
const rows = (out) => Number(String(out).trim()) || 0;

export async function setSapState({
  db, proposalId, sapStatus, contractNo, mockStaging = false,
  run = runSql, runFile = runSqlFile, readWide = runSqlWide, writeTemp = writeTempSql, log = () => {},
}) {
  if (!GUID_RE.test(proposalId || '')) throw new Error(`Invalid proposalId (must be GUID): ${proposalId}`);
  const hasStatus = sapStatus !== undefined;
  const hasContract = contractNo !== undefined && contractNo !== null && contractNo !== '';
  if (!hasStatus && !hasContract && !mockStaging) throw new Error('nothing to update: provide sapStatus, contractNo, and/or mockStaging');
  if (hasStatus && !STATUS_VALUES.has(sapStatus)) throw new Error(`Invalid sapStatus "${sapStatus}" (expected success, fail, or "")`);
  if (hasContract && !CONTRACT_RE.test(contractNo)) throw new Error(`Invalid contractNo "${contractNo}"`);

  assertDevDbServer(db.server, db.allowedServers);

  const result = {
    mockStaging: { applied: false, rowsInserted: 0 },
    status: { applied: false, rows: 0 },
    contract: { applied: false, table: null, rows: 0, skippedReason: null },
    payload: { applied: false, rows: 0, updated: 0, skippedReason: null },
  };
  const sam = { server: db.server, ...db.sam };
  const sap = { server: db.server, ...db.sap };
  const id = esc(proposalId);

  // Insert the mocked staging row FIRST — the contract/payload UPDATEs below
  // assume a staging row already exists (they no-op on 0 matched rows).
  if (mockStaging) {
    try {
      const r = await mockStagingRow({ db, proposalId, run, log });
      result.mockStaging = { applied: true, ...r };
    } catch (e) {
      result.mockStaging = { applied: false, rowsInserted: 0, error: e.message };
      log(`  mock staging FAILED: ${e.message}`);
    }
  }

  if (hasStatus) {
    try {
      log(`set Proposal.SAPStatus='${sapStatus}' where Id=${proposalId}`);
      const out = await run({ ...sam, sql: `SET NOCOUNT ON; UPDATE Proposal SET SAPStatus='${esc(sapStatus)}' WHERE Id='${id}'; SELECT @@ROWCOUNT;` });
      result.status = { applied: true, rows: rows(out) };
      log(`  rows affected: ${result.status.rows}`);
    } catch (e) {
      result.status = { applied: false, rows: 0, error: e.message };
      log(`  status FAILED: ${e.message}`);
    }
  }

  if (hasContract) {
    try {
      log('lookup proposal type');
      const typeOut = await run({ ...sam, sql: `SET NOCOUNT ON; SELECT ProposalGroupId FROM Proposal WHERE Id='${id}';` });
      const groupId = Number(String(typeOut).trim());
      if (!groupId) {
        result.contract.skippedReason = 'proposal not found';
        log('  contract skipped: proposal not found');
      } else if (!CONTRACT_TABLE[groupId]) {
        result.contract.skippedReason = `ProposalGroupId=${groupId} has no SAP contract table`;
        log(`  contract skipped: ${result.contract.skippedReason}`);
      } else {
        const { table, col } = CONTRACT_TABLE[groupId];
        log(`set ${table}.${col}='${esc(contractNo)}' where PROPOSAL_ID=${proposalId}`);
        const out = await run({ ...sap, sql: `SET NOCOUNT ON; UPDATE ${table} SET ${col}='${esc(contractNo)}' WHERE PROPOSAL_ID='${id}'; SELECT @@ROWCOUNT;` });
        result.contract = { applied: true, table, rows: rows(out), skippedReason: null };
        log(`  rows affected: ${result.contract.rows}`);
      }
    } catch (e) {
      result.contract = { ...result.contract, applied: false, error: e.message };
      log(`  contract FAILED: ${e.message}`);
    }
  }

  // Write the contract into ProposalDetail.RebatePayload JSON (all products).
  if (hasContract) {
    try {
      log('read ProposalDetail.RebatePayload');
      const payloadJson = await readWide({ ...sam, sql: `SET NOCOUNT ON; SELECT RebatePayload FROM dbo.ProposalDetail WHERE ProposalId='${id}';` });
      if (!payloadJson || !payloadJson.trim()) {
        result.payload.skippedReason = 'no RebatePayload (detail missing or empty)';
        log(`  payload skipped: ${result.payload.skippedReason}`);
      } else {
        const payload = JSON.parse(payloadJson);
        const updated = upsertContractForAllProducts(payload, contractNo);
        if (updated === 0) {
          result.payload.skippedReason = 'no products in payload';
          log(`  payload skipped: ${result.payload.skippedReason}`);
        } else {
          const newJson = JSON.stringify(payload);
          const sql = `SET NOCOUNT ON; UPDATE dbo.ProposalDetail SET RebatePayload='${esc(newJson)}' WHERE ProposalId='${id}'; SELECT @@ROWCOUNT;`;
          const tmp = await writeTemp(sql);
          try {
            const out = await runFile({ ...sam, file: tmp.path });
            result.payload = { applied: true, rows: rows(out), updated, skippedReason: null };
            log(`  payload rows affected: ${result.payload.rows} (products updated: ${updated})`);
          } finally {
            await tmp.cleanup();
          }
        }
      }
    } catch (e) {
      result.payload = { ...result.payload, applied: false, error: e.message };
      log(`  payload FAILED: ${e.message}`);
    }
  }

  return result;
}
