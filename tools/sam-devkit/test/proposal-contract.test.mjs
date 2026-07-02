import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setProposalContract } from '../lib/proposal-contract.mjs';

const GUID = '11111111-1111-1111-1111-111111111111';
const db = { server: 'localhost', sam: { database: 'SamDb', user: 'sa', password: 'pw' }, allowedServers: [] };

const PAYLOAD = JSON.stringify({
  products: [{ colId: 'col-1', productId: 'P100' }, { colId: 'col-2', productId: 'P200' }],
  values: { contract: {} },
});

// fake temp writer: captures contents, returns a fake path + noop cleanup
function tempWriter() {
  const calls = [];
  return { calls, writeTemp: async (contents) => { calls.push(contents); return { path: '/tmp/fake.sql', cleanup: async () => {} }; } };
}

test('column step updates ProposalProductTypeP.CONTRACT (all products when no productCode)', async () => {
  const calls = [];
  const run = async ({ sql }) => { calls.push(sql); if (/UPDATE dbo\.ProposalProductTypeP/.test(sql)) return '2'; return PAYLOAD; };
  const runFile = async () => '1';
  const { writeTemp } = tempWriter();
  const r = await setProposalContract({ db, proposalId: GUID, contractNo: 'C-1', run, readWide: run, runFile, writeTemp });
  assert.equal(r.column.applied, true);
  assert.equal(r.column.rows, 2);
  const upd = calls.find((s) => /UPDATE dbo\.ProposalProductTypeP/.test(s));
  assert.match(upd, /SET CONTRACT='C-1' WHERE PROPOSAL_ID='11111111-/);
  assert.doesNotMatch(upd, /PRODUCT_CODE/); // no productCode → all rows
});

test('column step scopes to PRODUCT_CODE when productCode given', async () => {
  const calls = [];
  const run = async ({ sql }) => { calls.push(sql); if (/UPDATE dbo\.ProposalProductTypeP/.test(sql)) return '1'; return PAYLOAD; };
  const { writeTemp } = tempWriter();
  await setProposalContract({ db, proposalId: GUID, contractNo: 'C-1', productCode: 'P100', run, readWide: run, runFile: async () => '1', writeTemp });
  const upd = calls.find((s) => /UPDATE dbo\.ProposalProductTypeP/.test(s));
  assert.match(upd, /AND PRODUCT_CODE='P100'/);
});

test('json step reads RebatePayload, upserts by productCode, writes via temp file', async () => {
  const run = async ({ sql }) => (/SELECT RebatePayload/.test(sql) ? PAYLOAD : '1');
  const runFile = async () => '1';
  const tw = tempWriter();
  const r = await setProposalContract({ db, proposalId: GUID, contractNo: 'C-9', productCode: 'P200', run, readWide: run, runFile, writeTemp: tw.writeTemp });
  assert.equal(r.json.applied, true);
  assert.equal(r.json.updated, 1);
  // the temp .sql contains the UPDATE with the new contract embedded in the JSON
  const sqlWritten = tw.calls[0];
  assert.match(sqlWritten, /UPDATE dbo\.ProposalDetail SET RebatePayload=/);
  assert.match(sqlWritten, /col-2/);
  assert.match(sqlWritten, /C-9/);
});

test('json step: product not found → skipped with reason, column still applied', async () => {
  const run = async ({ sql }) => (/SELECT RebatePayload/.test(sql) ? PAYLOAD : '1');
  const tw = tempWriter();
  const r = await setProposalContract({ db, proposalId: GUID, contractNo: 'C-1', productCode: 'ZZZ', run, readWide: run, runFile: async () => '1', writeTemp: tw.writeTemp });
  assert.equal(r.json.applied, false);
  assert.match(r.json.skippedReason, /not found/i);
  assert.equal(tw.calls.length, 0); // never wrote a temp file
});

test('json step: empty RebatePayload → skipped', async () => {
  const run = async ({ sql }) => (/SELECT RebatePayload/.test(sql) ? '' : '1');
  const tw = tempWriter();
  const r = await setProposalContract({ db, proposalId: GUID, contractNo: 'C-1', run, readWide: run, runFile: async () => '1', writeTemp: tw.writeTemp });
  assert.equal(r.json.applied, false);
  assert.match(r.json.skippedReason, /no RebatePayload|not found/i);
});

test('partial success: column throws, json still runs', async () => {
  const run = async ({ sql }) => {
    if (/UPDATE dbo\.ProposalProductTypeP/.test(sql)) throw new Error('col boom');
    if (/SELECT RebatePayload/.test(sql)) return PAYLOAD;
    return '1';
  };
  const tw = tempWriter();
  const r = await setProposalContract({ db, proposalId: GUID, contractNo: 'C-1', run, readWide: run, runFile: async () => '1', writeTemp: tw.writeTemp });
  assert.equal(r.column.applied, false);
  assert.match(r.column.error, /col boom/);
  assert.equal(r.json.applied, true);
});

test('rejects bad proposalId / contractNo / productCode / nothing', async () => {
  await assert.rejects(() => setProposalContract({ db, proposalId: 'x', contractNo: 'C-1' }), /GUID/i);
  await assert.rejects(() => setProposalContract({ db, proposalId: GUID, contractNo: "bad'; DROP" }), /contractNo/);
  await assert.rejects(() => setProposalContract({ db, proposalId: GUID, contractNo: 'C-1', productCode: "x'y" }), /productCode/);
  await assert.rejects(() => setProposalContract({ db, proposalId: GUID }), /contractNo/);
});

test('rejects non-dev server before any DB write', async () => {
  const prodDb = { ...db, server: 'sql-prod-01' };
  await assert.rejects(() => setProposalContract({ db: prodDb, proposalId: GUID, contractNo: 'C-1', run: async () => '1', runFile: async () => '1' }), /non-dev db server/i);
});

test('temp file is cleaned up even when runFile throws', async () => {
  let cleaned = false;
  const writeTemp = async () => ({ path: '/tmp/fake.sql', cleanup: async () => { cleaned = true; } });
  const run = async ({ sql }) => (/SELECT RebatePayload/.test(sql) ? PAYLOAD : '1');
  const runFile = async () => { throw new Error('runfile boom'); };
  const r = await setProposalContract({ db, proposalId: GUID, contractNo: 'C-1', productCode: 'P100', run, readWide: run, runFile, writeTemp });
  assert.equal(cleaned, true, 'cleanup() must run even when runFile throws');
  assert.equal(r.json.applied, false);
  assert.match(r.json.error, /runfile boom/);
});

test('partial success: column applies, json step throws → reported per-step', async () => {
  const run = async ({ sql }) => {
    if (/UPDATE dbo\.ProposalProductTypeP/.test(sql)) return '1';       // column OK
    if (/SELECT RebatePayload/.test(sql)) throw new Error('select boom'); // json read fails
    return '1';
  };
  const { writeTemp } = tempWriter();
  const r = await setProposalContract({ db, proposalId: GUID, contractNo: 'C-1', run, readWide: run, runFile: async () => '1', writeTemp });
  assert.equal(r.column.applied, true);
  assert.equal(r.json.applied, false);
  assert.match(r.json.error, /select boom/);
});
