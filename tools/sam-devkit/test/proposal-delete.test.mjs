import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deleteProposal, DELETE_ROLE_ORDER } from '../lib/proposal-delete.mjs';

const GUID = '11111111-1111-1111-1111-111111111111';

function fakeClient() {
  return {
    calls: [],
    async login(acct) { this.calls.push(['login', acct]); return { token: `tok-${acct.role}` }; },
    async delete(path, token) { this.calls.push(['delete', path, token]); return {}; },
  };
}

test('DELETE_ROLE_ORDER is srp first, cdr last', () => {
  assert.deepEqual(DELETE_ROLE_ORDER, ['srp', 'sam', 'sdm', 'pte', 'cdr']);
});

test('logs in as the first configured role (srp) and DELETEs the proposal', async () => {
  const client = fakeClient();
  const accounts = { sdm: { email: 'sdm@x', password: 'y' }, srp: { email: 'srp@x', password: 'y' } };
  const out = await deleteProposal({ client, accounts, proposalId: GUID });
  assert.equal(out.role, 'srp');
  assert.equal(out.deleted, true);
  assert.deepEqual(client.calls[0], ['login', { email: 'srp@x', password: 'y', role: 'srp' }]);
  assert.deepEqual(client.calls[1], ['delete', `/requests/${GUID}`, 'tok-srp']);
});

test('falls back to the next configured role when srp is missing', async () => {
  const client = fakeClient();
  const accounts = { pte: { email: 'pte@x', password: 'y' }, cdr: { email: 'cdr@x', password: 'y' } };
  const out = await deleteProposal({ client, accounts, proposalId: GUID });
  assert.equal(out.role, 'pte');
});

test('throws when no role account is configured at all', async () => {
  const client = fakeClient();
  await assert.rejects(
    deleteProposal({ client, accounts: {}, proposalId: GUID }),
    /No configured account/,
  );
  assert.equal(client.calls.length, 0);
});

test('rejects a non-GUID proposalId before any network call', async () => {
  const client = fakeClient();
  await assert.rejects(
    deleteProposal({ client, accounts: { srp: { email: 'a', password: 'b' } }, proposalId: 'bad' }),
    /GUID/i,
  );
  assert.equal(client.calls.length, 0);
});
