import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actOnStep } from '../lib/approval-step.mjs';

function fakeClient({ proposalStatus = 2, canApprove = true, rowVersion = 'RV1' } = {}) {
  return {
    calls: [],
    async login(acct) { this.calls.push(['login', acct]); return { token: `tok-${acct.email}` }; },
    async get(path, token) { this.calls.push(['get', path, token]); return { proposalStatus, rowVersion, canApprove }; },
    async put(path, token, body) { this.calls.push(['put', path, body]); return { id: 'P1', status: 'Success' }; },
  };
}

const account = { email: 'sdm@example.com', password: 'x' };

test('approve: logs in, PUTs isApprove:true with empty reason', async () => {
  const client = fakeClient();
  const out = await actOnStep({ client, account, role: 'sdm', proposalId: 'P1', isApprove: true, reason: '' });
  assert.equal(out.action, 'approved');
  const put = client.calls.find((c) => c[0] === 'put');
  assert.deepEqual(put[2], { isApprove: true, rowVersion: 'RV1', reason: '' });
  assert.equal(put[1], '/requests/P1/approve');
});

test('reject: PUTs isApprove:false with the trimmed reason', async () => {
  const client = fakeClient();
  const out = await actOnStep({ client, account, role: 'sdm', proposalId: 'P1', isApprove: false, reason: '  price too low  ' });
  assert.equal(out.action, 'rejected');
  const put = client.calls.find((c) => c[0] === 'put');
  assert.deepEqual(put[2], { isApprove: false, rowVersion: 'RV1', reason: 'price too low' });
});

test('reject without a reason throws before any network call', async () => {
  const client = fakeClient();
  await assert.rejects(
    actOnStep({ client, account, role: 'sdm', proposalId: 'P1', isApprove: false, reason: '   ' }),
    /Reject requires a non-empty reason/,
  );
  assert.equal(client.calls.length, 0);
});

test('blocked when it is not this role\'s turn (canApprove=false) — no PUT', async () => {
  const client = fakeClient({ canApprove: false });
  await assert.rejects(
    actOnStep({ client, account, role: 'sdm', proposalId: 'P1', isApprove: true, reason: '' }),
    /Not this role's turn/,
  );
  assert.ok(!client.calls.some((c) => c[0] === 'put'));
});

test('blocked when proposal is already Approved — no PUT', async () => {
  const client = fakeClient({ proposalStatus: 3 });
  await assert.rejects(
    actOnStep({ client, account, role: 'sdm', proposalId: 'P1', isApprove: true, reason: '' }),
    /already Approved/,
  );
  assert.ok(!client.calls.some((c) => c[0] === 'put'));
});

test('blocked when proposal is already Rejected — no PUT', async () => {
  const client = fakeClient({ proposalStatus: 4 });
  await assert.rejects(
    actOnStep({ client, account, role: 'sdm', proposalId: 'P1', isApprove: false, reason: 'x' }),
    /already Rejected/,
  );
  assert.ok(!client.calls.some((c) => c[0] === 'put'));
});
