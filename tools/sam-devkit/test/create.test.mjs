import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProposal } from '../lib/create.mjs';

function recordingClient() {
  const calls = [];
  return {
    calls,
    async login() { return { token: 'tok' }; },
    async post(path, token, body) {
      calls.push(['post', path, body]);
      if (path === '/requests') return { id: 'C1' };
      return { id: 'C1', requestNo: 'R2600100', version: 1 };
    },
    async patch(path, token, body) { calls.push(['patch', path, body]); return { id: 'C1', requestNo: 'R2600100', version: 1 }; },
    async put(path, token, body) { calls.push(['put', path, body]); return {}; },
  };
}

test('create maps type R to proposalGroupId 2 and submits', async () => {
  const client = recordingClient();
  const out = await createProposal({
    client, account: { email: 'srp', password: 'x' },
    type: 'R', salesOrgId: '1000', customerGroupId: 'cg-1', month: 7, year: 2026,
    productIds: ['PRODX'],
  });
  assert.equal(out.proposalId, 'C1');
  const create = client.calls.find((c) => c[1] === '/requests')[2];
  assert.equal(create.createMode, 1);
  assert.equal(create.proposalGroupId, 2); // R = 2
  const detail = client.calls.find((c) => c[1] === '/requests/C1/proposal-details')[2];
  assert.ok(detail.rebatePayload.includes('PRODX'));
  assert.deepEqual(client.calls.at(-1), ['put', '/requests/C1/submit', undefined]);
});

test('rawPayload overrides template', async () => {
  const client = recordingClient();
  await createProposal({
    client, account: { email: 'srp', password: 'x' },
    type: 'P', salesOrgId: '1000', customerGroupId: 'cg-1', month: 7, year: 2026,
    rawPayload: { rebatePayload: '{"raw":true}' },
  });
  const create = client.calls.find((c) => c[1] === '/requests')[2];
  assert.equal(create.proposalGroupId, 1); // P = 1
  const detail = client.calls.find((c) => c[1] === '/requests/C1/proposal-details')[2];
  assert.equal(detail.rebatePayload, '{"raw":true}');
});
