import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setSapState } from '../lib/sap-fixup.mjs';

const GUID = '11111111-1111-1111-1111-111111111111';
const db = {
  server: 'localhost',
  sam: { database: 'SamDb', user: 'sa', password: 'pw' },
  sap: { database: 'SapDb', user: 'sa', password: 'pw' },
};

// fake runner: records every sql; returns queued outputs in order
function runner(outputs) {
  const calls = [];
  const q = [...outputs];
  const run = async ({ database, sql }) => { calls.push({ database, sql }); return q.shift(); };
  return { run, calls };
}

test('status-only updates Proposal on sam db and reports rows', async () => {
  const { run, calls } = runner(['1']);
  const r = await setSapState({ db, proposalId: GUID, sapStatus: 'success', run });
  assert.equal(r.status.applied, true);
  assert.equal(r.status.rows, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].database, 'SamDb');
  assert.match(calls[0].sql, /UPDATE Proposal SET SAPStatus='success' WHERE Id='11111111-/);
});

test('contract update auto-detects Type P -> CreateContract.SAP_CONTRACT_NO on sap db', async () => {
  const { run, calls } = runner(['1', '2']); // [type lookup=1(P), update rowcount=2]
  const r = await setSapState({ db, proposalId: GUID, contractNo: 'C-500', run });
  assert.equal(r.contract.applied, true);
  assert.equal(r.contract.table, 'CreateContract');
  assert.equal(r.contract.rows, 2);
  assert.match(calls[0].sql, /SELECT ProposalGroupId FROM Proposal/);
  assert.equal(calls[1].database, 'SapDb');
  assert.match(calls[1].sql, /UPDATE CreateContract SET SAP_CONTRACT_NO='C-500' WHERE PROPOSAL_ID='11111111-/);
});

test('Type S -> ChangeContract.CONTRACT_NO', async () => {
  const { run, calls } = runner(['3', '1']); // type=3(S)
  const r = await setSapState({ db, proposalId: GUID, contractNo: 'C-9', run });
  assert.equal(r.contract.table, 'ChangeContract');
  assert.match(calls[1].sql, /UPDATE ChangeContract SET CONTRACT_NO='C-9'/);
});

test('Type R skips contract with a reason, but status still applied', async () => {
  const { run, calls } = runner(['1', '2']); // status update=1row, then type lookup=2(R)
  const r = await setSapState({ db, proposalId: GUID, sapStatus: 'fail', contractNo: 'C-1', run });
  assert.equal(r.status.applied, true);
  assert.equal(r.contract.applied, false);
  assert.match(r.contract.skippedReason, /no SAP contract table/i);
  assert.equal(calls.length, 2); // status update + type lookup; no contract UPDATE
});

test('proposal not found -> contract skipped with reason', async () => {
  const { run } = runner(['']); // empty type lookup
  const r = await setSapState({ db, proposalId: GUID, contractNo: 'C-1', run });
  assert.equal(r.contract.applied, false);
  assert.match(r.contract.skippedReason, /not found/i);
});

test('partial success: status ok, contract runner throws -> reported per-step', async () => {
  let n = 0;
  const run = async ({ sql }) => {
    n++;
    if (/UPDATE Proposal/.test(sql)) return '1';
    throw new Error('boom on lookup');
  };
  const r = await setSapState({ db, proposalId: GUID, sapStatus: 'success', contractNo: 'C-1', run });
  assert.equal(r.status.applied, true);
  assert.equal(r.contract.applied, false);
  assert.match(r.contract.error, /boom/);
});

test('rejects bad proposalId', async () => {
  await assert.rejects(() => setSapState({ db, proposalId: 'nope', sapStatus: 'success' }), /GUID/i);
});

test('rejects bad sapStatus', async () => {
  await assert.rejects(() => setSapState({ db, proposalId: GUID, sapStatus: 'weird', run: async () => '1' }), /sapStatus/);
});

test('rejects bad contractNo', async () => {
  await assert.rejects(() => setSapState({ db, proposalId: GUID, contractNo: "x'; DROP--", run: async () => '1' }), /contractNo/);
});

test('rejects nothing-to-update', async () => {
  await assert.rejects(() => setSapState({ db, proposalId: GUID, run: async () => '1' }), /nothing to update/i);
});

test('contractNo null is treated as no contract (nothing-to-update throws)', async () => {
  await assert.rejects(() => setSapState({ db, proposalId: GUID, contractNo: null, run: async () => '1' }), /nothing to update/i);
});

test('null contractNo with a valid status applies status only, no contract lookup', async () => {
  const { run, calls } = runner(['1']);
  const r = await setSapState({ db, proposalId: GUID, sapStatus: 'success', contractNo: null, run });
  assert.equal(r.status.applied, true);
  assert.equal(r.contract.applied, false);
  assert.equal(calls.length, 1); // only the status UPDATE — no type lookup, no contract UPDATE
});

test('rejects a non-dev DB server before any DB write', async () => {
  const prodDb = { ...db, server: 'sql-prod-01' };
  await assert.rejects(() => setSapState({ db: prodDb, proposalId: GUID, sapStatus: 'success', run: async () => '1' }), /non-dev db server/i);
});
