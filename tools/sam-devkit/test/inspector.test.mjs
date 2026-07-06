import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizePayload, orderLineage, deriveCurrentStep, computeWhoCanApprove, runDiagnosis, inspectProposal } from '../lib/inspector.mjs';

// ---------------------------------------------------------------- payload ---

// Real shape: pages[].payload is DOUBLE-ENCODED (a JSON string) — see json-contract.mjs
const page = (products, values, extra = {}) =>
  ({ payload: JSON.stringify({ products, values: values ?? {} }), ...extra });

test('summarizePayload counts active/deleted pages and unique products', () => {
  const doc = {
    schemaVersion: 2,
    pages: [
      page([{ colId: 'col-1', productId: 'P100' }, { colId: 'col-2', productId: 'P200' }]),
      page([{ colId: 'col-1', productId: 'P100' }]),
      page([{ colId: 'col-1', productId: 'P900' }], null, { deleted: true }),
    ],
  };
  const s = summarizePayload(JSON.stringify(doc));
  assert.equal(s.schemaVersion, 2);
  assert.equal(s.activePages, 2);
  assert.equal(s.deletedPages, 1);
  assert.deepEqual(s.productIds, ['P100', 'P200']); // deleted page's P900 excluded, dedup P100
});

test('summarizePayload extracts contract values per product from values.contract', () => {
  const doc = {
    schemaVersion: 2,
    pages: [page(
      [{ colId: 'col-1', productId: 'P100' }, { colId: 'col-2', productId: 'P200' }],
      { contract: { 'col-1': { old: '41000778', new: 'C-500' }, 'col-2': { new: '' } } },
    )],
  };
  const s = summarizePayload(JSON.stringify(doc));
  assert.deepEqual(s.contracts, [
    { productId: 'P100', colId: 'col-1', value: 'C-500' },
    { productId: 'P200', colId: 'col-2', value: '' },
  ]);
});

test('summarizePayload handles empty/absent payload', () => {
  assert.equal(summarizePayload(''), null);
  assert.equal(summarizePayload(null), null);
  assert.equal(summarizePayload('not json {'), null);
});

test('summarizePayload tolerates flat single-page payload (no pages array)', () => {
  const s = summarizePayload(JSON.stringify({ products: [{ colId: 'col-1', productId: 'P1' }], values: {} }));
  assert.equal(s.activePages, 1);
  assert.deepEqual(s.productIds, ['P1']);
});

test('summarizePayload tolerates page payload already an object (not double-encoded)', () => {
  const doc = { schemaVersion: 2, pages: [{ payload: { products: [{ productId: 'P7' }], values: {} } }] };
  const s = summarizePayload(JSON.stringify(doc));
  assert.equal(s.activePages, 1);
  assert.deepEqual(s.productIds, ['P7']);
});

// ---------------------------------------------------------------- lineage ---

const L = (id, previousId, version, status = 3, requestNo = 'REQ-1') =>
  ({ id, previousId, version, status, requestNo });

test('orderLineage orders a simple ancestor chain and flags current', () => {
  // fetched unordered: v2(current) ← v1 ← v0
  const rows = [L('b', 'a', 1), L('c', 'b', 2, 2), L('a', null, 0)];
  const chain = orderLineage(rows, 'c');
  assert.deepEqual(chain.map((n) => n.id), ['a', 'b', 'c']);
  assert.deepEqual(chain.map((n) => n.current), [false, false, true]);
});

test('orderLineage includes descendants after the current node', () => {
  // current is v1; someone already cloned it to v2
  const rows = [L('a', null, 0), L('b', 'a', 1, 3), L('c', 'b', 2, 1)];
  const chain = orderLineage(rows, 'b');
  assert.deepEqual(chain.map((n) => n.id), ['a', 'b', 'c']);
  assert.equal(chain[1].current, true);
});

test('orderLineage handles branch (two clones of same source) — orders by version', () => {
  const rows = [L('a', null, 0), L('b', 'a', 1), L('b2', 'a', 2, 1, 'REQ-2')];
  const chain = orderLineage(rows, 'a');
  assert.deepEqual(chain.map((n) => n.id), ['a', 'b', 'b2']);
});

test('orderLineage single node (no ancestors, no clones)', () => {
  const chain = orderLineage([L('x', null, 0, 2)], 'x');
  assert.deepEqual(chain.map((n) => n.id), ['x']);
  assert.equal(chain[0].current, true);
});

test('orderLineage survives a broken chain (previousId row missing)', () => {
  // ancestor row got deleted from DB — chain starts at first known node
  const rows = [L('b', 'missing', 1), L('c', 'b', 2)];
  const chain = orderLineage(rows, 'c');
  assert.deepEqual(chain.map((n) => n.id), ['b', 'c']);
});

// --------------------------------------------------------------- step ------

// ApprovalAction: Approved=3, Rejected=4, Skipped=5 (ApprovalStatus.cs)
const H = (roleCode, action = 3, flags = {}) =>
  ({ roleCode, action, isBypass: false, isDelegate: false, ...flags });

test('deriveCurrentStep: sam+sdm approved, pending → next is pte', () => {
  const s = deriveCurrentStep([H('sam'), H('sdm')], 2);
  assert.equal(s.state, 'pending');
  assert.equal(s.nextRole, 'pte');
});

test('deriveCurrentStep: no history yet, pending → next is sam', () => {
  const s = deriveCurrentStep([], 2);
  assert.equal(s.nextRole, 'sam');
});

test('deriveCurrentStep: ASM bypass row counts as done for sam', () => {
  const s = deriveCurrentStep([H('sam', 3, { isBypass: true })], 2);
  assert.equal(s.nextRole, 'sdm');
});

test('deriveCurrentStep: delegate row counts as done for that role', () => {
  const s = deriveCurrentStep([H('sam'), H('sdm', 3, { isDelegate: true })], 2);
  assert.equal(s.nextRole, 'pte');
});

test('deriveCurrentStep: approved proposal → complete, no next role', () => {
  const s = deriveCurrentStep([H('sam'), H('sdm'), H('pte'), H('cdr')], 3);
  assert.equal(s.state, 'approved');
  assert.equal(s.nextRole, null);
});

test('deriveCurrentStep: rejected → reports which role rejected', () => {
  const s = deriveCurrentStep([H('sam'), H('sdm', 4)], 4);
  assert.equal(s.state, 'rejected');
  assert.equal(s.rejectedBy, 'sdm');
  assert.equal(s.nextRole, null);
});

test('deriveCurrentStep: status 10 → blocked, still knows the waiting role', () => {
  const s = deriveCurrentStep([H('sam'), H('sdm')], 10);
  assert.equal(s.state, 'blocked');
  assert.equal(s.nextRole, 'pte');
});

test('deriveCurrentStep: Draft/Temp → not submitted', () => {
  assert.equal(deriveCurrentStep([], 1).state, 'not-submitted');
  assert.equal(deriveCurrentStep([], 0).state, 'not-submitted');
  assert.equal(deriveCurrentStep([], 1).nextRole, null);
});

// ------------------------------------------------------- who can approve ---

const U = (id, name, over = {}) =>
  ({ id, name, email: `${name.toLowerCase().replace(/\W/g, '.')}@dev.sam`, isActive: true, isLock: false, ...over });
const DELEG = (userId, delegateToId, delegateToName, fromDate, toDate) =>
  ({ userId, delegateToId, delegateToName, fromDate, toDate });
const TODAY = '2026-07-04';

test('whoCanApprove: pte step — active users eligible, locked user flagged', () => {
  const r = computeWhoCanApprove({
    step: { state: 'pending', nextRole: 'pte' },
    roleUsers: [U('u1', 'Pornthip S'), U('u2', 'Wichai K', { isLock: true })],
    delegates: [], creator: { id: 'c1', reportToId: 'm1' }, today: TODAY,
  });
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].eligible, true);
  assert.equal(r.rows[1].eligible, false);
  assert.match(r.rows[1].reasons.join(' '), /lock/i);
});

test('whoCanApprove: delegate active today → delegator flagged, target noted', () => {
  const r = computeWhoCanApprove({
    step: { state: 'pending', nextRole: 'sdm' },
    roleUsers: [U('sdm1', 'Somsak T'), U('sdm2', 'Boonmee K')],
    delegates: [DELEG('sdm1', 'x9', 'Boonmee K', '2026-06-20', '2026-07-05')],
    creator: { id: 'c1', reportToId: 'm1' }, today: TODAY,
  });
  const d = r.rows.find((x) => x.id === 'sdm1');
  assert.equal(d.eligible, false);
  assert.match(d.reasons.join(' '), /delegat/i);
  assert.equal(d.delegatedTo, 'Boonmee K');
  assert.equal(r.sdmAutoDelegate, false); // sdm2 not delegating
});

test('whoCanApprove: delegate outside date range does not count', () => {
  const r = computeWhoCanApprove({
    step: { state: 'pending', nextRole: 'sdm' },
    roleUsers: [U('sdm1', 'Somsak T')],
    delegates: [DELEG('sdm1', 'x9', 'B', '2026-05-01', '2026-05-31')],
    creator: { id: 'c1' }, today: TODAY,
  });
  assert.equal(r.rows[0].eligible, true);
});

test('whoCanApprove: ALL SDM delegating → sdmAutoDelegate true (step auto-skips)', () => {
  const r = computeWhoCanApprove({
    step: { state: 'pending', nextRole: 'sdm' },
    roleUsers: [U('sdm1', 'A'), U('sdm2', 'B')],
    delegates: [DELEG('sdm1', 'x', 'X', '2026-07-01', '2026-07-10'), DELEG('sdm2', 'y', 'Y', '2026-07-01', '2026-07-10')],
    creator: { id: 'c1' }, today: TODAY,
  });
  assert.equal(r.sdmAutoDelegate, true);
});

test('whoCanApprove: sam step — only creator-or-manager passes sam-track ownership', () => {
  const r = computeWhoCanApprove({
    step: { state: 'pending', nextRole: 'sam' },
    roleUsers: [U('mgr', 'Anucha P'), U('other', 'Kittipong N')],
    delegates: [],
    creator: { id: 'c1', reportToId: 'mgr' }, today: TODAY,
  });
  assert.equal(r.rows.find((x) => x.id === 'mgr').eligible, true);
  const o = r.rows.find((x) => x.id === 'other');
  assert.equal(o.eligible, false);
  assert.match(o.reasons.join(' '), /ownership|manager|403/i);
});

test('whoCanApprove: sam step — creator who is ASM themselves is eligible', () => {
  const r = computeWhoCanApprove({
    step: { state: 'pending', nextRole: 'sam' },
    roleUsers: [U('c1', 'Anucha P')],   // creator IS the sam user
    delegates: [], creator: { id: 'c1', reportToId: null }, today: TODAY,
  });
  assert.equal(r.rows[0].eligible, true);
});

test('whoCanApprove: inactive user flagged ineligible', () => {
  const r = computeWhoCanApprove({
    step: { state: 'pending', nextRole: 'cdr' },
    roleUsers: [U('u1', 'Chatri C', { isActive: false })],
    delegates: [], creator: { id: 'c1' }, today: TODAY,
  });
  assert.equal(r.rows[0].eligible, false);
  assert.match(r.rows[0].reasons.join(' '), /inactive/i);
});

test('whoCanApprove: terminal state → empty rows', () => {
  const r = computeWhoCanApprove({
    step: { state: 'approved', nextRole: null },
    roleUsers: [], delegates: [], creator: { id: 'c1' }, today: TODAY,
  });
  assert.deepEqual(r.rows, []);
});

// -------------------------------------------------------------- diagnosis --

const NOW_YM = { year: 2026, month: 7 };
const byId = (checks, id) => checks.find((c) => c.id === id);

test('diagnosis: healthy approved proposal → everything ok', () => {
  const checks = runDiagnosis({
    proposal: { status: 3, year: 2026, month: 7, sapStatus: 'success' },
    closedPeriods: [], cgConflicts: [], today: NOW_YM,
  });
  assert.ok(checks.length >= 6);
  assert.ok(checks.every((c) => c.level === 'ok'));
});

test('diagnosis: status 10 → sentinel check fails (err)', () => {
  const checks = runDiagnosis({
    proposal: { status: 10, year: 2026, month: 6, sapStatus: '' },
    closedPeriods: [], cgConflicts: [], today: NOW_YM,
  });
  assert.equal(byId(checks, 'sentinel-10').level, 'err');
  assert.match(byId(checks, 'sentinel-10').detail, /reset|Pending\(2\)/i);
});

test('diagnosis: Temp(0) → cleanup warning', () => {
  const checks = runDiagnosis({
    proposal: { status: 0, year: 2026, month: 7, sapStatus: '' },
    closedPeriods: [], cgConflicts: [], today: NOW_YM,
  });
  assert.equal(byId(checks, 'temp-cleanup').level, 'warn');
});

test('diagnosis: closed month blocks Draft submit (err) but only warns a Pending', () => {
  const closed = [202606];
  const draft = runDiagnosis({
    proposal: { status: 1, year: 2026, month: 6, sapStatus: '' },
    closedPeriods: closed, cgConflicts: [], today: NOW_YM,
  });
  assert.equal(byId(draft, 'close-month').level, 'err');
  const pending = runDiagnosis({
    proposal: { status: 2, year: 2026, month: 6, sapStatus: '' },
    closedPeriods: closed, cgConflicts: [], today: NOW_YM,
  });
  assert.equal(byId(pending, 'close-month').level, 'warn');
});

test('diagnosis: approved without SAPStatus → sap-sync warn (async CDR job)', () => {
  const checks = runDiagnosis({
    proposal: { status: 3, year: 2026, month: 7, sapStatus: '' },
    closedPeriods: [], cgConflicts: [], today: NOW_YM,
  });
  assert.equal(byId(checks, 'sap-sync').level, 'warn');
  assert.match(byId(checks, 'sap-sync').detail, /hangfire|async|job/i);
});

test('diagnosis: SAPStatus=fail → sap-sync err', () => {
  const checks = runDiagnosis({
    proposal: { status: 3, year: 2026, month: 7, sapStatus: 'fail' },
    closedPeriods: [], cgConflicts: [], today: NOW_YM,
  });
  assert.equal(byId(checks, 'sap-sync').level, 'err');
});

test('diagnosis: CG conflict listed in warning', () => {
  const checks = runDiagnosis({
    proposal: { status: 1, year: 2026, month: 7, sapStatus: '' },
    closedPeriods: [], cgConflicts: [{ requestNo: 'J-S001-P2600009', version: 0, status: 1 }], today: NOW_YM,
  });
  assert.equal(byId(checks, 'cg-conflict').level, 'warn');
  assert.match(byId(checks, 'cg-conflict').detail, /P2600009/);
});

test('diagnosis: past-month proposal → month-rule warn (cannot clone into it)', () => {
  const checks = runDiagnosis({
    proposal: { status: 3, year: 2026, month: 6, sapStatus: 'success' },
    closedPeriods: [], cgConflicts: [], today: NOW_YM,
  });
  assert.equal(byId(checks, 'month-rule').level, 'warn');
});

// ----------------------------------------------------------- orchestration --

const GUID = '11111111-1111-1111-1111-111111111111';
const DB = { server: 'localhost', sam: { database: 'SamDb', user: 'sa', password: 'pw' } };

// Dispatch fake: first regex that matches the SQL wins.
function reader(routes) {
  const calls = [];
  const readWide = async ({ sql }) => {
    calls.push(sql);
    for (const [re, val] of routes) if (re.test(sql)) return typeof val === 'function' ? val(sql) : val;
    throw new Error(`no fake route for SQL: ${sql.slice(0, 120)}`);
  };
  return { readWide, calls };
}

const HEADER = {
  id: GUID, previousId: null, requestNo: 'J-S001-P2600005', version: 1,
  groupId: 1, status: 2, sapStatus: '', year: 2026, month: 7,
  customerGroupId: '22222222-2222-2222-2222-222222222222', customerGroupCode: 'CG-BKK-003',
  regionName: 'Central', saleOrgCode: 'S854', saleOfficeCode: 'S001', saleOfficeName: 'Bangkok',
  creatorId: 'c1', creatorName: 'Anucha P.', creatorRole: 'sam', creatorReportTo: 'mgr9',
  requestDate: '2026-06-28T11:30:00', approvalDate: null, lastApprovalName: null,
  startDate: '2026-07-01', endDate: '2026-12-31', rowVersion: '0x0000B1204',
};

function happyRoutes() {
  return [
    [/WITH chain/i, JSON.stringify([
      { id: 'prev0', previousId: null, requestNo: 'J-S001-P2600005', version: 0, status: 3 },
      { id: GUID, previousId: 'prev0', requestNo: 'J-S001-P2600005', version: 1, status: 2 },
    ])],
    [/SELECT TOP 1[\s\S]*FROM dbo\.Proposal p/, JSON.stringify(HEADER)],
    [/FROM dbo\.ApprovalHistory/, JSON.stringify([
      { roleCode: 'sam', roleName: 'Area Sales Manager', approver: 'Anucha P.', action: 3, actionDate: '2026-06-28T11:30:05', comment: null, isDelegate: false, isBypass: true },
    ])],
    [/FROM identity\.AspNetUsers[\s\S]*RoleCode IN/, JSON.stringify([
      { id: 'sdm1', name: 'Boonmee K.', email: 'boonmee@dev.sam', roleCode: 'sdm', isActive: true, isLock: false },
      { id: 'pte1', name: 'Pornthip S.', email: 'pornthip@dev.sam', roleCode: 'pte', isActive: true, isLock: false },
    ])],
    [/FROM dbo\.UserDelegate/, JSON.stringify([])],
    [/FROM dbo\.CloseMonth/, JSON.stringify([{ period: 202605 }])],
    [/cg-conflict|ProposalStatus IN \(1, ?2\)/, JSON.stringify([])],
    [/SELECT RebatePayload/, JSON.stringify({ schemaVersion: 2, pages: [{ payload: JSON.stringify({ products: [{ colId: 'col-1', productId: 'P100' }], values: {} }) }] })],
    [/SELECT SpecialPayload/, ''],
    [/SELECT AccumPayload/, ''],
    [/proposalCustomers|FROM dbo\.ProposalCustomer/, JSON.stringify({
      customers: [{ code: 'C000112', name: 'BKK Modern Trade' }],
      products: [{ code: 'P100', rows: 4 }],
      files: [{ name: 'contract.pdf', path: 'prop/a71e/cd.pdf' }],
    })],
  ];
}

test('inspectProposal wires everything: header, lineage, step, who, diagnosis, payloads, related', async () => {
  const { readWide } = reader(happyRoutes());
  const r = await inspectProposal({ db: DB, proposalId: GUID, readWide, now: () => Date.parse('2026-07-04T10:00:00Z') });

  assert.equal(r.proposal.requestNo, 'J-S001-P2600005');
  assert.equal(r.proposal.statusName, 'Pending');
  assert.equal(r.proposal.typeLetter, 'P');

  assert.deepEqual(r.lineage.map((n) => n.version), [0, 1]);
  assert.equal(r.lineage[1].current, true);

  assert.equal(r.timeline.length, 1);
  assert.equal(r.timeline[0].isBypass, true);

  // sam bypassed → next is sdm; sdm1 eligible (no delegate)
  assert.equal(r.step.nextRole, 'sdm');
  assert.equal(r.who.rows.length, 1);
  assert.equal(r.who.rows[0].name, 'Boonmee K.');
  assert.equal(r.who.rows[0].eligible, true);

  assert.ok(r.diagnosis.find((c) => c.id === 'close-month').level === 'ok'); // 202607 not closed
  assert.equal(r.payloads.rebate.productIds[0], 'P100');
  assert.equal(r.payloads.special, null);
  assert.equal(r.related.customers[0].code, 'C000112');
});

test('inspectProposal throws when proposal not found', async () => {
  const { readWide } = reader([[/FROM dbo\.Proposal p/, '']]);
  await assert.rejects(() => inspectProposal({ db: DB, proposalId: GUID, readWide }), /not found/i);
});

test('inspectProposal rejects a bad proposalId before touching the DB', async () => {
  let called = false;
  await assert.rejects(
    () => inspectProposal({ db: DB, proposalId: 'nope', readWide: async () => { called = true; return ''; } }),
    /GUID/i,
  );
  assert.equal(called, false);
});

test('inspectProposal enforces the dev-host DB guard', async () => {
  await assert.rejects(
    () => inspectProposal({ db: { ...DB, server: 'sql-prod-01' }, proposalId: GUID, readWide: async () => '' }),
    /non-dev db server/i,
  );
});
