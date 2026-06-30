import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloneProposal } from '../lib/clone.mjs';

function recordingClient() {
  const calls = [];
  return {
    calls,
    async login() { return { token: 'tok' }; },
    async post(path, token, body) {
      calls.push(['post', path, body]);
      if (path === '/requests') return { id: 'NEW1', previousId: 'SRC1' };
      return { id: 'NEW1', requestNo: 'R2600099', version: 1 };
    },
    async patch(path, token, body) { calls.push(['patch', path, body]); return { id: 'NEW1', requestNo: 'R2600099', version: 1 }; },
    async put(path, token, body) { calls.push(['put', path, body]); return {}; },
    async get(path, token) {
      calls.push(['get', path]);
      return { rebatePayload: '{"schemaVersion":2}', specialPayload: '', accumPayload: '' };
    },
  };
}

test('clone runs create(Existing) -> general-info -> get details -> post details -> submit', async () => {
  const client = recordingClient();
  const out = await cloneProposal({
    client,
    account: { email: 'srp', password: 'x' },
    source: { requestNo: 'R2600001', version: 3, salesOrgId: '1000', proposalGroupId: 2, customerGroupId: 'cg-1' },
    month: 7, year: 2026,
  });
  assert.equal(out.proposalId, 'NEW1');
  assert.equal(out.requestNo, 'R2600099');

  const create = client.calls.find((c) => c[0] === 'post' && c[1] === '/requests')[2];
  assert.equal(create.createMode, 0);
  assert.equal(create.requestNo, 'R2600001');
  assert.equal(create.version, 3);

  // details GET hits the NEW proposal, not the source
  assert.ok(client.calls.some((c) => c[0] === 'get' && c[1] === '/requests/NEW1/proposal-details'));

  // posted details echo the GET payloads verbatim
  const detailPost = client.calls.find((c) => c[0] === 'post' && c[1] === '/requests/NEW1/proposal-details')[2];
  assert.equal(detailPost.rebatePayload, '{"schemaVersion":2}');
  assert.equal(detailPost.proposalId, 'NEW1');

  // submit last
  assert.deepEqual(client.calls.at(-1), ['put', '/requests/NEW1/submit', undefined]);
});

test('omits empty payloads from details post', async () => {
  const client = recordingClient();
  await cloneProposal({
    client, account: { email: 'srp', password: 'x' },
    source: { requestNo: 'R1', version: 1, salesOrgId: '1000', proposalGroupId: 2, customerGroupId: 'cg-1' },
    month: 7, year: 2026,
  });
  const detailPost = client.calls.find((c) => c[0] === 'post' && c[1] === '/requests/NEW1/proposal-details')[2];
  assert.equal(detailPost.specialPayload, undefined); // '' dropped
  assert.equal(detailPost.accumPayload, undefined);
});
