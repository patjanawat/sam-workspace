import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkLogins, checkReportTo, checkCloneSource, checkOptionsData, checkCloseMonth, runPreflight,
} from '../lib/preflight.mjs';

// -------------------------------------------------------------- logins ----

test('checkLogins: one attempt per configured role, never retries', async () => {
  const accounts = { srp: { email: 'a@x', password: 'p' }, sam: { email: 'b@x', password: 'p' } };
  const calls = [];
  const login = async (role, acct) => {
    calls.push(role);
    if (role === 'sam') throw Object.assign(new Error('401'), { status: 401 });
    return { token: 't' };
  };
  const results = await checkLogins(accounts, login);
  assert.equal(calls.length, 2);                 // exactly one attempt each — no retry loop
  assert.equal(results.find((r) => r.role === 'srp').ok, true);
  assert.equal(results.find((r) => r.role === 'sam').ok, false);
  assert.match(results.find((r) => r.role === 'sam').error, /401/);
});

test('checkLogins: skips roles missing from config, does not throw', async () => {
  const results = await checkLogins({ srp: { email: 'a@x', password: 'p' } }, async () => ({ token: 't' }));
  assert.equal(results.length, 1);
});

// ------------------------------------------------------------- reportTo ---

test('checkReportTo: srp.ReportToId matches the sam account — full chain possible', () => {
  const r = checkReportTo({ srpUser: { reportToId: 'sam-id' }, samUser: { id: 'sam-id' } });
  assert.equal(r.ok, true);
});

test('checkReportTo: mismatch — falls back to submit-as-sam mode', () => {
  const r = checkReportTo({ srpUser: { reportToId: 'other-sam' }, samUser: { id: 'sam-id' } });
  assert.equal(r.ok, false);
  assert.match(r.detail, /submit as sam|option \(b\)/i);
});

test('checkReportTo: either user missing → unresolved, not a false failure', () => {
  const r = checkReportTo({ srpUser: null, samUser: { id: 'sam-id' } });
  assert.equal(r.ok, null);
});

// ---------------------------------------------------------- clone source --

test('checkCloneSource: at least one Approved proposal found', () => {
  const r = checkCloneSource([{ requestNo: 'R1', status: 3 }, { requestNo: 'R2', status: 1 }]);
  assert.equal(r.ok, true);
  assert.equal(r.example.requestNo, 'R1');
});

test('checkCloneSource: none approved → fails with a clear reason', () => {
  const r = checkCloneSource([{ requestNo: 'R2', status: 1 }]);
  assert.equal(r.ok, false);
});

// -------------------------------------------------------------- options ---

test('checkOptionsData: dropdowns all non-empty', () => {
  const r = checkOptionsData({ customers: [1], saleOrganizations: [1], proposalGroups: [1] });
  assert.equal(r.ok, true);
});

test('checkOptionsData: reports which dropdown is empty', () => {
  const r = checkOptionsData({ customers: [], saleOrganizations: [1], proposalGroups: [1] });
  assert.equal(r.ok, false);
  assert.match(r.detail, /customers/i);
});

// ------------------------------------------------------------ closeMonth --

test('checkCloseMonth: current period open', () => {
  const r = checkCloseMonth({ period: 202607, closedPeriods: [202606] });
  assert.equal(r.ok, true);
});

test('checkCloseMonth: current period closed — blocks submit/create', () => {
  const r = checkCloseMonth({ period: 202607, closedPeriods: [202607] });
  assert.equal(r.ok, false);
});

// ----------------------------------------------------------- orchestration --

const DB = { server: 'localhost', sam: {} };
const CFG = {
  apiBaseUrl: 'http://localhost:5000',
  roles: { srp: { email: 'srp@x', password: 'p' }, sam: { email: 'sam@x', password: 'p' } },
};

test('runPreflight composes every check and returns an overall summary', async () => {
  const login = async (role) => ({ token: 't-' + role });
  const apiGet = async (path) => {
    if (path === '/requests/options') return { customers: [1], saleOrganizations: [1], proposalGroups: [1] };
    throw new Error('unexpected path ' + path);
  };
  const readWide = async ({ sql }) => {
    if (/AspNetUsers.*Email/i.test(sql)) return JSON.stringify([{ id: 'srp-id', email: 'srp@x', reportToId: 'sam-id' }, { id: 'sam-id', email: 'sam@x', reportToId: null }]);
    if (/FROM dbo\.Proposal/.test(sql)) return JSON.stringify([{ requestNo: 'R1', status: 3 }]);
    if (/FROM dbo\.CloseMonth/.test(sql)) return JSON.stringify([]);
    throw new Error('unexpected sql ' + sql.slice(0, 60));
  };
  const r = await runPreflight({ db: DB, cfg: CFG, login, apiGet, readWide, now: () => Date.parse('2026-07-04T00:00:00Z') });
  assert.equal(r.checks.length, 5);          // logins collapse to 1 line + 4 more
  assert.equal(r.ready, true);
});

test('runPreflight: any failing check flips ready=false', async () => {
  const login = async (role) => { if (role === 'sam') throw Object.assign(new Error('401'), { status: 401 }); return { token: 't' }; };
  const apiGet = async () => ({ customers: [], saleOrganizations: [], proposalGroups: [] });
  const readWide = async ({ sql }) => {
    if (/AspNetUsers.*Email/i.test(sql)) return JSON.stringify([]);
    if (/FROM dbo\.Proposal/.test(sql)) return JSON.stringify([]);
    if (/FROM dbo\.CloseMonth/.test(sql)) return JSON.stringify([{ period: 202607 }]);
    return '[]';
  };
  const r = await runPreflight({ db: DB, cfg: CFG, login, apiGet, readWide, now: () => Date.parse('2026-07-04T00:00:00Z') });
  assert.equal(r.ready, false);
});
