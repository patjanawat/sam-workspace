import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markProposalDraft } from '../lib/mark-draft.mjs';

const GUID = '11111111-1111-1111-1111-111111111111';
const DB = { server: 'localhost', sam: { database: 'SamDb', user: 'sa', password: 'pw' } };

test('markProposalDraft issues the Temp(0)->Draft(1) UPDATE, guarded by status', async () => {
  const calls = [];
  const run = async ({ sql }) => { calls.push(sql); return '1'; };
  const r = await markProposalDraft({ db: DB, proposalId: GUID, run });
  assert.equal(r.rows, 1);
  assert.match(calls[0], /UPDATE dbo\.Proposal SET ProposalStatus = 1 WHERE Id='11111111-1111-1111-1111-111111111111' AND ProposalStatus = 0/);
});

test('reports 0 rows affected without throwing when the id is not Temp(0)', async () => {
  const run = async () => '0';
  const r = await markProposalDraft({ db: DB, proposalId: GUID, run });
  assert.equal(r.rows, 0);
});

test('rejects a non-GUID proposalId', async () => {
  await assert.rejects(() => markProposalDraft({ db: DB, proposalId: 'bad', run: async () => '0' }), /GUID/i);
});

test('rejects a non-dev DB server', async () => {
  await assert.rejects(
    () => markProposalDraft({ db: { ...DB, server: 'prod-sql' }, proposalId: GUID, run: async () => '0' }),
    /non-dev/i,
  );
});
