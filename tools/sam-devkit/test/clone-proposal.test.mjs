import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchProposals, recentProposals, generateRequestNo, cloneProposal } from '../lib/clone-proposal.mjs';

const SRC = '11111111-1111-1111-1111-111111111111';
const db = {
  server: 'localhost',
  sam: { database: 'SamDb', user: 'sa', password: 'pw' },
  sap: { database: 'SapDb', user: 'sa', password: 'pw' },
};

// 2026-07-15 12:00 UTC → Thai month = 7, year 2026
const NOW = () => Date.UTC(2026, 6, 15, 12, 0, 0);

const srcRow = (over = {}) => JSON.stringify({
  id: SRC, requestNo: 'J-S001-R2600013', version: 2, groupId: 2, status: 3,
  sapStatus: 'success', saleOrgCode: 'S854', saleOfficeCode: 'S001', ...over,
});

// fake runners: record every call, return queued outputs in order
function harness({ runOuts = [], wideOuts = [], fileOuts = [] } = {}) {
  const calls = { run: [], wide: [], file: [], sqlFiles: [] };
  const rq = [...runOuts], wq = [...wideOuts], fq = [...fileOuts];
  return {
    calls,
    run: async ({ database, sql }) => { calls.run.push({ database, sql }); return rq.shift(); },
    readWide: async ({ database, sql }) => { calls.wide.push({ database, sql }); return wq.shift(); },
    runFile: async ({ database, file }) => { calls.file.push({ database, file }); return fq.shift(); },
    writeTemp: async (sql) => { calls.sqlFiles.push(sql); return { path: 'X.sql', cleanup: async () => {} }; },
  };
}

const COUNTS = 'Proposal:1\nProposalDetail:1\nProposalCustomer:3\nProposalProduct:5\nProposalProductTypeP:0\nProposalProductTypeRS:42\nProposalFile:2';

// ---------- searchProposals ----------

test('search queries sam db with LIKE and parses JSON rows', async () => {
  const h = harness({ wideOuts: [JSON.stringify([{ id: SRC, requestNo: 'J-S001-R2600013', version: 2 }])] });
  const r = await searchProposals({ db, requestNo: 'R2600', readWide: h.readWide });
  assert.equal(r.proposals.length, 1);
  assert.equal(h.calls.wide[0].database, 'SamDb');
  assert.match(h.calls.wide[0].sql, /LIKE '%R2600%'/);
  assert.match(h.calls.wide[0].sql, /FOR JSON PATH/);
  assert.match(h.calls.wide[0].sql, /PreviousId\) AS previousId/); // FE deep link needs sourceId
});

test('search escapes LIKE wildcards in the term', async () => {
  const h = harness({ wideOuts: ['[]'] });
  await searchProposals({ db, requestNo: 'R26-00', readWide: h.readWide });
  assert.match(h.calls.wide[0].sql, /LIKE '%R26-00%'/);
});

test('search rejects short and unsafe terms', async () => {
  await assert.rejects(() => searchProposals({ db, requestNo: 'R' }), /too short/i);
  await assert.rejects(() => searchProposals({ db, requestNo: "R'; DROP" }), /Invalid search term/i);
});

// ---------- recentProposals ----------

test('recent queries sam db, no WHERE/term, orders by CreatedDateUTC desc, top 10', async () => {
  const h = harness({ wideOuts: [JSON.stringify([{ id: SRC, requestNo: 'J-S001-R2600013', version: 2 }])] });
  const r = await recentProposals({ db, readWide: h.readWide });
  assert.equal(r.proposals.length, 1);
  assert.equal(h.calls.wide[0].database, 'SamDb');
  assert.match(h.calls.wide[0].sql, /TOP 10/);
  assert.match(h.calls.wide[0].sql, /ORDER BY p\.CreatedDateUTC DESC/);
  assert.doesNotMatch(h.calls.wide[0].sql, /WHERE/);
  assert.match(h.calls.wide[0].sql, /FOR JSON PATH/);
});

test('recent returns empty array when DB has no rows', async () => {
  const h = harness({ wideOuts: ['[]'] });
  const r = await recentProposals({ db, readWide: h.readWide });
  assert.deepEqual(r.proposals, []);
});

// ---------- generateRequestNo ----------

test('generates prefix from org/office/group + Thai yy, running = max+1', async () => {
  const h = harness({ runOuts: ['13'] });
  const source = { saleOrgCode: 'S854', saleOfficeCode: 'S001', groupId: 2 };
  const rn = await generateRequestNo({ db, source, run: h.run, now: NOW });
  assert.equal(rn, 'J-S001-R2600014');
  assert.match(h.calls.run[0].sql, /LIKE 'J-S001-R26\[0-9\]/);
});

test('org initial: S899 -> A, unknown -> X; running pads to 5 digits', async () => {
  const h = harness({ runOuts: ['0', '0'] });
  const a = await generateRequestNo({ db, source: { saleOrgCode: 'S899', saleOfficeCode: 'S002', groupId: 3 }, run: h.run, now: NOW });
  const x = await generateRequestNo({ db, source: { saleOrgCode: 'S777', saleOfficeCode: 'S003', groupId: 1 }, run: h.run, now: NOW });
  assert.equal(a, 'A-S002-S2600001');
  assert.equal(x, 'X-S003-P2600001');
});

// ---------- cloneProposal: validation ----------

test('rejects bad sourceId / mode / newRequestNo', async () => {
  await assert.rejects(() => cloneProposal({ db, sourceId: 'nope', mode: 'new-version' }), /GUID/i);
  await assert.rejects(() => cloneProposal({ db, sourceId: SRC, mode: 'upgrade' }), /Invalid mode/i);
  await assert.rejects(() => cloneProposal({ db, sourceId: SRC, mode: 'new-proposal', newRequestNo: "x'; --" }), /Invalid newRequestNo/i);
});

test('source not found', async () => {
  const h = harness({ wideOuts: [''] });
  await assert.rejects(() => cloneProposal({ db, sourceId: SRC, mode: 'new-version', readWide: h.readWide }), /not found/i);
});

test('Type P + new-proposal is blocked', async () => {
  const h = harness({ wideOuts: [srcRow({ groupId: 1 })] });
  await assert.rejects(
    () => cloneProposal({ db, sourceId: SRC, mode: 'new-proposal', readWide: h.readWide }),
    /Type P must clone to a new version/i,
  );
});

test('duplicate RequestNo+Version rejected before insert', async () => {
  const h = harness({ wideOuts: [srcRow()], runOuts: ['2', '1'] }); // maxVersion=2, dup count=1
  await assert.rejects(
    () => cloneProposal({ db, sourceId: SRC, mode: 'new-version', run: h.run, readWide: h.readWide, now: NOW }),
    /already exists/i,
  );
});

// ---------- cloneProposal: new-version ----------

test('new-version: same RequestNo, version=max+1, current Thai month, batch inserts', async () => {
  const h = harness({ wideOuts: [srcRow()], runOuts: ['4', '0'], fileOuts: [COUNTS] });
  const r = await cloneProposal({ db, sourceId: SRC, mode: 'new-version', run: h.run, runFile: h.runFile, readWide: h.readWide, writeTemp: h.writeTemp, now: NOW });

  assert.equal(r.requestNo, 'J-S001-R2600013');
  assert.equal(r.version, 5);
  assert.equal(r.year, 2026);
  assert.equal(r.month, 7);
  assert.equal(r.status, 'Draft');
  assert.equal(r.warnings.length, 0);
  assert.equal(r.copied.ProposalProductTypeRS, 42);
  assert.match(r.newId, /^[0-9a-f-]{36}$/);

  assert.match(h.calls.run[0].sql, /MAX\(Version\).+RequestNo = 'J-S001-R2600013'/s);
  assert.match(h.calls.run[1].sql, /COUNT\(\*\).+Version = 5/s);

  const batch = h.calls.sqlFiles[0];
  assert.match(batch, /BEGIN TRAN;/);
  assert.match(batch, /SET XACT_ABORT ON;/);
  assert.match(batch, new RegExp(`DECLARE @src UNIQUEIDENTIFIER = '${SRC}'`));
  assert.match(batch, new RegExp(`DECLARE @new UNIQUEIDENTIFIER = '${r.newId}'`));
  // overrides: Draft(1), month, SAPStatus reset, source version NOT copied
  assert.match(batch, /SELECT @new, N''J-S001-R2600013'', 5, 1, @src, GETUTCDATE\(\), GETUTCDATE\(\), 2026, 7, N''''/);
  // rowversion + overridden columns excluded from the dynamic list
  assert.match(batch, /t\.name NOT IN \('timestamp','rowversion'\)/);
  assert.match(batch, /'Id','RequestNo','Version','ProposalStatus','PreviousId','RequestDateUTC','CreatedDateUTC','Year','Month','SAPStatus'/);
  // all child tables present with pk/fk override
  for (const t of ['ProposalDetail', 'ProposalCustomer', 'ProposalProduct', 'ProposalProductTypeP', 'ProposalProductTypeRS', 'ProposalFile']) {
    assert.match(batch, new RegExp(`INSERT INTO dbo\\.${t} `));
  }
  assert.match(batch, /INSERT INTO dbo\.ProposalDetail \(\[Id\],\[ProposalId\],' \+ @cols \+ '\)\nSELECT NEWID\(\), @new,/);
  assert.match(batch, /INSERT INTO dbo\.ProposalCustomer \(\[ID\],\[PROPOSAL_ID\],/);
  assert.match(batch, /COMMIT;/);
});

// ---------- cloneProposal: new-proposal ----------

test('new-proposal: auto-generated RequestNo, version 0, month+1', async () => {
  // run calls: [gen max tail=77, dup count=0]
  const h = harness({ wideOuts: [srcRow()], runOuts: ['77', '0'], fileOuts: [COUNTS] });
  const r = await cloneProposal({ db, sourceId: SRC, mode: 'new-proposal', run: h.run, runFile: h.runFile, readWide: h.readWide, writeTemp: h.writeTemp, now: NOW });
  assert.equal(r.requestNo, 'J-S001-R2600078');
  assert.equal(r.version, 0);
  assert.equal(r.month, 8); // current 7 + 1
  assert.equal(r.year, 2026);
});

test('new-proposal: typed RequestNo skips generation', async () => {
  const h = harness({ wideOuts: [srcRow()], runOuts: ['0'], fileOuts: [COUNTS] }); // only dup check
  const r = await cloneProposal({ db, sourceId: SRC, mode: 'new-proposal', newRequestNo: 'J-S001-R2699999', run: h.run, runFile: h.runFile, readWide: h.readWide, writeTemp: h.writeTemp, now: NOW });
  assert.equal(r.requestNo, 'J-S001-R2699999');
  assert.equal(h.calls.run.length, 1); // no MAX-tail query
  assert.match(h.calls.run[0].sql, /COUNT\(\*\)/);
});

test('december rolls the year for new-proposal', async () => {
  const dec = () => Date.UTC(2026, 11, 20, 12, 0, 0);
  const h = harness({ wideOuts: [srcRow()], runOuts: ['0', '0'], fileOuts: [COUNTS] });
  const r = await cloneProposal({ db, sourceId: SRC, mode: 'new-proposal', run: h.run, runFile: h.runFile, readWide: h.readWide, writeTemp: h.writeTemp, now: dec });
  assert.equal(r.year, 2027);
  assert.equal(r.month, 1);
});

// ---------- warnings ----------

test('non-approved source warns but clones', async () => {
  const h = harness({ wideOuts: [srcRow({ status: 1 })], runOuts: ['2', '0'], fileOuts: [COUNTS] });
  const r = await cloneProposal({ db, sourceId: SRC, mode: 'new-version', run: h.run, runFile: h.runFile, readWide: h.readWide, writeTemp: h.writeTemp, now: NOW });
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /not Approved/i);
  assert.equal(r.copied.Proposal, 1);
});

test('Type P without SAP success warns, new-version still allowed', async () => {
  const h = harness({ wideOuts: [srcRow({ groupId: 1, sapStatus: '' })], runOuts: ['1', '0'], fileOuts: [COUNTS] });
  const r = await cloneProposal({ db, sourceId: SRC, mode: 'new-version', run: h.run, runFile: h.runFile, readWide: h.readWide, writeTemp: h.writeTemp, now: NOW });
  assert.match(r.warnings[0], /SAPStatus=success/);
  assert.equal(r.version, 2);
});
