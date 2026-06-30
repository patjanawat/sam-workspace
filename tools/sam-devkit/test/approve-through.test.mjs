import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approveThrough, detailPath } from '../lib/approve-through.mjs';

test('detailPath routes sam to sam-track, others to sdm-track', () => {
  assert.equal(detailPath('sam', 'X'), '/approval/sam/X');
  assert.equal(detailPath('sdm', 'X'), '/approval/sdm/X');
  assert.equal(detailPath('pte', 'X'), '/approval/sdm/X');
  assert.equal(detailPath('cdr', 'X'), '/approval/sdm/X');
});

// Fake client that walks the proposal forward one step per approve.
function fakeClient(scenario) {
  // scenario.steps: ordered list of role codes that are "current" (CanApprove=true).
  // Each approve advances the pointer. cdr approve returns a job + sets status Approved.
  let idx = 0;
  let status = 2; // Pending
  let jobId = null;
  return {
    calls: [],
    async login(acct) { return { token: `tok-${acct.email}`, roleCode: acct.email }; },
    async get(path, token) {
      this.calls.push(['get', path, token]);
      const role = path.includes('/approval/sam/') ? 'sam' : 'sdm-track';
      // current waiting role is scenario.steps[idx]
      const current = scenario.steps[idx] ?? null;
      // sam-track is only queried for sam; canApprove true if current step is the role asking
      const askingRole = scenario._asking;
      return { proposalStatus: status, rowVersion: `RV${idx}`, canApprove: current === askingRole };
    },
    async put(path, token, body) {
      this.calls.push(['put', path, body]);
      const role = scenario.steps[idx];
      idx += 1;
      if (role === 'cdr') { status = 2; jobId = 'job-123'; return { id: 'P1', status: 'Pending', jobId }; }
      return { id: 'P1', status: 'Success', jobId: '' };
    },
  };
}

test('full chain srp-submitted: approves sam,sdm,pte,cdr', async () => {
  const scenario = { steps: ['sam', 'sdm', 'pte', 'cdr'] };
  const client = fakeClient(scenario);
  // patch get to know which role is asking (login sets it)
  const origLogin = client.login.bind(client);
  client.login = async (acct) => { scenario._asking = acct.role; return origLogin(acct); };
  const accounts = {
    sam: { email: 'sam', role: 'sam', password: 'x' },
    sdm: { email: 'sdm', role: 'sdm', password: 'x' },
    pte: { email: 'pte', role: 'pte', password: 'x' },
    cdr: { email: 'cdr', role: 'cdr', password: 'x' },
  };
  const out = await approveThrough({ client, accounts, proposalId: 'P1' });
  const approved = out.steps.filter((s) => s.action === 'approved').map((s) => s.role);
  assert.deepEqual(approved, ['sam', 'sdm', 'pte', 'cdr']);
  assert.equal(out.cdrJobId, 'job-123');
});

test('sam auto-bypassed (sam not current): skips sam, approves sdm,pte,cdr', async () => {
  const scenario = { steps: ['sdm', 'pte', 'cdr'] };
  const client = fakeClient(scenario);
  const origLogin = client.login.bind(client);
  client.login = async (acct) => { scenario._asking = acct.role; return origLogin(acct); };
  const accounts = {
    sam: { email: 'sam', role: 'sam', password: 'x' },
    sdm: { email: 'sdm', role: 'sdm', password: 'x' },
    pte: { email: 'pte', role: 'pte', password: 'x' },
    cdr: { email: 'cdr', role: 'cdr', password: 'x' },
  };
  const out = await approveThrough({ client, accounts, proposalId: 'P1' });
  const actions = Object.fromEntries(out.steps.map((s) => [s.role, s.action]));
  assert.equal(actions.sam, 'skipped');
  assert.equal(actions.sdm, 'approved');
  assert.equal(actions.cdr, 'approved');
});
