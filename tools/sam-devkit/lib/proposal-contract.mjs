import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertDevDbServer } from './guard.mjs';
import { runSql, runSqlFile } from './db.mjs';
import { upsertContractByProductId, upsertContractForAllProducts } from './json-contract.mjs';

const GUID_RE = /^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$/;
const CONTRACT_RE = /^[A-Za-z0-9_\-/]{1,16}$/;   // ProposalProductTypeP.CONTRACT is nvarchar(16)
const PRODUCT_RE = /^[A-Za-z0-9_\-/.]{1,16}$/;

const esc = (v) => String(v).replace(/'/g, "''");
const rows = (out) => Number(String(out).trim()) || 0;

// default temp writer: writes a UTF-8 .sql file, returns its path + a cleanup fn
async function defaultWriteTemp(contents) {
  // Date.now/Math.random are unavailable in some sandboxes but this file runs in the real server process.
  const path = join(tmpdir(), `sam-devkit-${process.pid}-${Date.now()}.sql`);
  await writeFile(path, contents, 'utf8');
  return { path, cleanup: () => unlink(path).catch(() => {}) };
}

export async function setProposalContract({
  db, proposalId, contractNo, productCode,
  run = runSql, runFile = runSqlFile, writeTemp = defaultWriteTemp, log = () => {},
}) {
  if (!GUID_RE.test(proposalId || '')) throw new Error(`Invalid proposalId (must be GUID): ${proposalId}`);
  if (contractNo === undefined || contractNo === null || contractNo === '') throw new Error('contractNo is required');
  if (!CONTRACT_RE.test(contractNo)) throw new Error(`Invalid contractNo "${contractNo}" (max 16, [A-Za-z0-9_-/])`);
  const hasProduct = productCode !== undefined && productCode !== null && productCode !== '';
  if (hasProduct && !PRODUCT_RE.test(productCode)) throw new Error(`Invalid productCode "${productCode}"`);

  assertDevDbServer(db.server, db.allowedServers);

  const sam = { server: db.server, ...db.sam };
  const id = esc(proposalId);
  const c = esc(contractNo);
  const result = { column: { applied: false, rows: 0 }, json: { applied: false, rows: 0, updated: 0, skippedReason: null } };

  // --- Step 1: plain column ProposalProductTypeP.CONTRACT ---
  try {
    const where = hasProduct
      ? `PROPOSAL_ID='${id}' AND PRODUCT_CODE='${esc(productCode)}'`
      : `PROPOSAL_ID='${id}'`;
    log(`update ProposalProductTypeP.CONTRACT='${contractNo}' where ${hasProduct ? `product ${productCode}` : 'all products'}`);
    const out = await run({ ...sam, sql: `SET NOCOUNT ON; UPDATE dbo.ProposalProductTypeP SET CONTRACT='${c}' WHERE ${where}; SELECT @@ROWCOUNT;` });
    result.column = { applied: true, rows: rows(out) };
    log(`  rows affected: ${result.column.rows}`);
  } catch (e) {
    result.column = { applied: false, rows: 0, error: e.message };
    log(`  column FAILED: ${e.message}`);
  }

  // --- Step 2: RebatePayload JSON ---
  try {
    log('read ProposalDetail.RebatePayload');
    const payloadJson = await run({ ...sam, sql: `SET NOCOUNT ON; SELECT RebatePayload FROM dbo.ProposalDetail WHERE ProposalId='${id}';` });
    if (!payloadJson || !payloadJson.trim()) {
      result.json.skippedReason = 'no RebatePayload (detail missing or empty)';
      log(`  json skipped: ${result.json.skippedReason}`);
    } else {
      const payload = JSON.parse(payloadJson);
      let updated;
      if (hasProduct) {
        updated = upsertContractByProductId(payload, productCode, contractNo) ? 1 : 0;
        if (updated === 0) {
          result.json.skippedReason = `product ${productCode} not found in payload`;
          log(`  json skipped: ${result.json.skippedReason}`);
        }
      } else {
        updated = upsertContractForAllProducts(payload, contractNo);
        if (updated === 0) result.json.skippedReason = 'no products in payload';
      }
      if (updated > 0) {
        const newJson = JSON.stringify(payload);
        const sql = `SET NOCOUNT ON; UPDATE dbo.ProposalDetail SET RebatePayload='${esc(newJson)}' WHERE ProposalId='${id}'; SELECT @@ROWCOUNT;`;
        const tmp = await writeTemp(sql);
        try {
          const out = await runFile({ ...sam, file: tmp.path });
          result.json = { applied: true, rows: rows(out), updated, skippedReason: null };
          log(`  json rows affected: ${result.json.rows} (products updated: ${updated})`);
        } finally {
          await tmp.cleanup();
        }
      }
    }
  } catch (e) {
    result.json = { ...result.json, applied: false, error: e.message };
    log(`  json FAILED: ${e.message}`);
  }

  return result;
}
