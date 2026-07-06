import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  managerChain, directReports, checkVisibility,
  parsePermissionsTs, parsePolicies, permissionMatrix,
  orgLookup, unlockUser,
} from '../lib/org-lookup.mjs';

const U = (id, name, roleCode, reportToId = null, over = {}) =>
  ({ id, name, email: name.toLowerCase().replace(/\W/g, '.') + '@dev.sam', roleCode, reportToId, isActive: true, isLock: false, ...over });

const USERS = [
  U('srp1', 'Somchai R', 'srp', 'sam1'),
  U('srp2', 'Prasert W', 'srp', 'sam1'),
  U('sam1', 'Anucha P', 'sam', 'sdm1'),
  U('sdm1', 'Boonmee K', 'sdm', null),
  U('pte1', 'Pornthip S', 'pte', null),
];

// ---------------------------------------------------------------- org tree --

test('managerChain walks ReportToId up to the top', () => {
  const chain = managerChain(USERS, 'srp1');
  assert.deepEqual(chain.map((u) => u.id), ['srp1', 'sam1', 'sdm1']);
});

test('managerChain survives a dangling ReportToId', () => {
  const chain = managerChain([U('a', 'A', 'srp', 'ghost')], 'a');
  assert.deepEqual(chain.map((u) => u.id), ['a']);
});

test('directReports lists subordinates + counts indirect ones', () => {
  const r = directReports(USERS, 'sdm1');
  assert.deepEqual(r.direct.map((u) => u.id), ['sam1']);
  assert.equal(r.indirectCount, 2); // srp1 + srp2 under sam1
});

// -------------------------------------------------------------- visibility --

test('checkVisibility: srp sees only own proposals', () => {
  const v = checkVisibility({ viewer: USERS[0], creator: USERS[1], users: USERS });
  assert.equal(v.canSeeInList, false);
  const own = checkVisibility({ viewer: USERS[0], creator: USERS[0], users: USERS });
  assert.equal(own.canSeeInList, true);
});

test('checkVisibility: sam sees own + direct reports; sam-track detail same rule', () => {
  const v = checkVisibility({ viewer: USERS[2], creator: USERS[0], users: USERS }); // sam1 vs srp1 (reports to sam1)
  assert.equal(v.canSeeInList, true);
  assert.equal(v.canOpenSamTrackDetail, true);
  const stranger = checkVisibility({ viewer: USERS[2], creator: U('x', 'X', 'srp', 'other-sam'), users: USERS });
  assert.equal(stranger.canSeeInList, false);
  assert.match(stranger.reasons.join(' '), /ReportToId|direct/i);
});

test('checkVisibility: sdm and above see everything in list, but sam-track detail still 403s', () => {
  const v = checkVisibility({ viewer: USERS[3], creator: USERS[0], users: USERS });
  assert.equal(v.canSeeInList, true);
  assert.equal(v.canOpenSamTrackDetail, false); // ownership check is creator/direct-manager only
  assert.equal(v.canOpenSdmTrackDetail, true);
});

// ----------------------------------------------------------------- parsers --

const PERMS_TS = `
export const ROLE_PERMISSIONS: Record<string, string[]> = {
  srp: [
    '/request',
    '/request/*',
    '/approval/*', // detail only
  ],
  sam: ['/request', '/approval', '/approval/*'],
};
export const ROLE_REDIRECTS: Record<string, string> = {
  srp: '/request',
  sam: '/approval',
};
`;

test('parsePermissionsTs extracts ROLE_PERMISSIONS + ROLE_REDIRECTS', () => {
  const p = parsePermissionsTs(PERMS_TS);
  assert.deepEqual(p.permissions.srp, ['/request', '/request/*', '/approval/*']);
  assert.equal(p.redirects.sam, '/approval');
});

const PROGRAM_CS = `
    options.AddPolicy("SystemAdminOnly", policy =>
        policy.RequireRole("System Admin"));
    options.AddPolicy("CreateProposal", policy =>
        policy.RequireRole("Sales Representative", "Area Sales Manager"));
    options.AddPolicy("SapReSync", policy => policy.RequireRole("Pricing Team", "System Admin"));
`;

test('parsePolicies extracts policy → role names', () => {
  const pol = parsePolicies(PROGRAM_CS);
  assert.deepEqual(pol.CreateProposal, ['Sales Representative', 'Area Sales Manager']);
  assert.deepEqual(pol.SapReSync, ['Pricing Team', 'System Admin']);
});

test('permissionMatrix: menus from permissions, policy pass/fail by role name', () => {
  const snapshot = {
    permissions: parsePermissionsTs(PERMS_TS).permissions,
    redirects: parsePermissionsTs(PERMS_TS).redirects,
    policies: parsePolicies(PROGRAM_CS),
  };
  const m = permissionMatrix({ roleCode: 'srp', snapshot });
  assert.deepEqual(m.menus, ['/request', '/request/*', '/approval/*']);
  assert.equal(m.landing, '/request');
  assert.equal(m.policies.find((p) => p.name === 'CreateProposal').allowed, true);
  assert.equal(m.policies.find((p) => p.name === 'SystemAdminOnly').allowed, false);
});

// ----------------------------------------------------------- orchestration --

const GUID = '11111111-1111-1111-1111-111111111111';
const DB = { server: 'localhost', sam: { database: 'SamDb', user: 'sa', password: 'pw' } };

test('orgLookup finds user by email and assembles card + chain + reports + delegates', async () => {
  const readWide = async ({ sql }) => {
    if (/FROM identity\.AspNetUsers/.test(sql)) {
      return JSON.stringify(USERS.map((u) => ({ ...u, isActive: 1, isLock: 0, saleOfficeCode: 'S001', saleOfficeName: 'BKK', saleGroupCode: 'G1', lockoutEnd: null })));
    }
    if (/FROM dbo\.UserDelegate/.test(sql)) {
      return JSON.stringify([{ userId: 'sdm1', delegateToId: 'pte1', delegateToName: 'Pornthip S', fromDate: '2026-07-01', toDate: '2026-07-10' }]);
    }
    throw new Error('unexpected sql');
  };
  const r = await orgLookup({ db: DB, query: 'somchai.r@dev.sam', readWide, now: () => Date.parse('2026-07-04T10:00:00Z') });
  assert.equal(r.user.id, 'srp1');
  assert.deepEqual(r.managerChain.map((u) => u.id), ['srp1', 'sam1', 'sdm1']);
  assert.equal(r.reports.direct.length, 0);
  // delegate on sdm1 is active today and surfaces on the chain
  assert.equal(r.delegatesActive.length, 1);
  assert.equal(r.delegatesActive[0].userId, 'sdm1');
});

test('orgLookup matches by partial name too and rejects short queries', async () => {
  const readWide = async () => JSON.stringify(USERS.map((u) => ({ ...u, isActive: 1, isLock: 0 })));
  const r = await orgLookup({ db: DB, query: 'Anucha', readWide });
  assert.equal(r.user.id, 'sam1');
  await assert.rejects(() => orgLookup({ db: DB, query: 'a', readWide }), /too short/i);
});

test('orgLookup throws when nobody matches', async () => {
  const readWide = async () => JSON.stringify([]);
  await assert.rejects(() => orgLookup({ db: DB, query: 'nobody@x', readWide }), /no user/i);
});

test('unlockUser issues the unlock UPDATE (only write in the module) with guards', async () => {
  const calls = [];
  const run = async ({ sql }) => { calls.push(sql); return '1'; };
  const r = await unlockUser({ db: DB, userId: GUID, run });
  assert.equal(r.rows, 1);
  assert.match(calls[0], /UPDATE AspNetUsers SET LockoutEnd = NULL, AccessFailedCount = 0/);
  await assert.rejects(() => unlockUser({ db: DB, userId: 'bad', run }), /GUID/i);
  await assert.rejects(() => unlockUser({ db: { ...DB, server: 'prod' }, userId: GUID, run }), /non-dev/i);
});
