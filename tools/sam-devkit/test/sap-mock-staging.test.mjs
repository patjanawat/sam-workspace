import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockStagingRow } from '../lib/sap-mock-staging.mjs';

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

test('Type P -> CreateContract, SAP_RETURN mocked to C', async () => {
  const { run, calls } = runner(['1', '2']); // groupId lookup=1(P), rows affected=2
  const r = await mockStagingRow({ db, proposalId: GUID, run });
  assert.equal(r.type, 'P');
  assert.equal(r.table, 'CreateContract');
  assert.equal(r.successReturn, 'C');
  assert.equal(r.rowsInserted, 2);
  assert.match(calls[0].sql, /SELECT ProposalGroupId FROM dbo\.Proposal/);
  assert.match(calls[1].sql, /MERGE \[SapDb\]\.dbo\.CreateContract AS tgt/);
  assert.match(calls[1].sql, /FROM   dbo\.ProposalProductTypeP pp/);
  assert.match(calls[1].sql, /WHEN MATCHED AND tgt\.SAP_MESSAGE = '.*MOCKED by sam-devkit.*' THEN/);
  assert.match(calls[1].sql, /SAP_RETURN = 'C'/);
  assert.match(calls[1].sql, /MOCKED by sam-devkit/);
});

test('Type R -> CreateDiscount, SAP_RETURN mocked to 0', async () => {
  const { run, calls } = runner(['2', '1']); // groupId=2(R)
  const r = await mockStagingRow({ db, proposalId: GUID, run });
  assert.equal(r.type, 'R');
  assert.equal(r.table, 'CreateDiscount');
  assert.equal(r.successReturn, '0');
  assert.match(calls[1].sql, /MERGE \[SapDb\]\.dbo\.CreateDiscount AS tgt/);
  assert.match(calls[1].sql, /FROM   dbo\.ProposalProductTypeRS rs/);
  assert.match(calls[1].sql, /rs\.RATE_TYPE   = 'Discount'/);
});

test('Type S -> ChangeContract, SAP_RETURN mocked to S', async () => {
  const { run, calls } = runner(['3', '1']); // groupId=3(S)
  const r = await mockStagingRow({ db, proposalId: GUID, run });
  assert.equal(r.type, 'S');
  assert.equal(r.table, 'ChangeContract');
  assert.equal(r.successReturn, 'S');
  assert.match(calls[1].sql, /MERGE \[SapDb\]\.dbo\.ChangeContract AS tgt/);
  assert.match(calls[1].sql, /pp\.PRODUCT_CODE/);
});

test('runs against the sam connection (cross-db bracket-qualified MERGE target)', async () => {
  const { run, calls } = runner(['1', '0']);
  await mockStagingRow({ db, proposalId: GUID, run });
  assert.equal(calls[0].database, 'SamDb');
  assert.equal(calls[1].database, 'SamDb');
});

test('only refreshes a target row already carrying the mock marker (real rows never matched by WHEN MATCHED)', async () => {
  const { run, calls } = runner(['1', '1']);
  await mockStagingRow({ db, proposalId: GUID, run });
  assert.match(calls[1].sql, /WHEN MATCHED AND tgt\.SAP_MESSAGE = '[^']*' THEN\s*\n\s*UPDATE SET/);
  assert.match(calls[1].sql, /WHEN NOT MATCHED THEN\s*\n\s*INSERT/);
});

test('0 rows affected is reported, not thrown (source data missing, or a REAL row occupies the key)', async () => {
  const { run } = runner(['1', '0']);
  const logs = [];
  const r = await mockStagingRow({ db, proposalId: GUID, run, log: (m) => logs.push(m) });
  assert.equal(r.rowsInserted, 0);
  assert.ok(logs.some((l) => /warn.*0 rows affected/i.test(l)));
});

test('unknown ProposalGroupId (proposal not found) throws', async () => {
  const { run } = runner(['']); // empty groupId lookup
  await assert.rejects(() => mockStagingRow({ db, proposalId: GUID, run }), /not found|unknown ProposalGroupId/i);
});

test('rejects bad proposalId', async () => {
  await assert.rejects(() => mockStagingRow({ db, proposalId: 'nope' }), /GUID/i);
});

test('rejects a non-dev DB server before any DB write', async () => {
  const prodDb = { ...db, server: 'sql-prod-01' };
  await assert.rejects(() => mockStagingRow({ db: prodDb, proposalId: GUID, run: async () => '1' }), /non-dev db server/i);
});

test('allowedServers lets a non-dev server through the guard', async () => {
  const prodDb = { ...db, server: '192.168.2.10,31433', allowedServers: ['192.168.2.10'] };
  const { run } = runner(['1', '1']);
  const r = await mockStagingRow({ db: prodDb, proposalId: GUID, run });
  assert.equal(r.rowsInserted, 1);
});
