import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLOW_BY_TYPE, decodeIndicator, compareSapState, sapInspect } from '../lib/sap-inspector.mjs';

// ------------------------------------------------------------- indicator ---

test('decodeIndicator: success value differs per flow', () => {
  assert.equal(decodeIndicator('CreateDiscount', '0').success, true);   // Type R
  assert.equal(decodeIndicator('CreateContract', 'C').success, true);   // Type P
  assert.equal(decodeIndicator('ChangeContract', 'S').success, true);   // Type S
  assert.equal(decodeIndicator('CreateDiscount', 'C').success, false);  // wrong flow's success code
  assert.equal(decodeIndicator('CreateDiscount', '').success, false);
  assert.equal(decodeIndicator('CreateDiscount', null).success, false);
});

test('decodeIndicator: unknown flow throws (guards against silently-wrong assumption)', () => {
  assert.throws(() => decodeIndicator('Bogus', '0'), /flow/i);
});

test('FLOW_BY_TYPE maps ProposalGroupId letter to the right staging flow', () => {
  assert.equal(FLOW_BY_TYPE.R, 'CreateDiscount');
  assert.equal(FLOW_BY_TYPE.P, 'CreateContract');
  assert.equal(FLOW_BY_TYPE.S, 'ChangeContract');
});

// ------------------------------------------------------------- compare ----

const row = (over = {}) => ({ id: 'r1', docNo: 'DOC1', period: 202607, sapReturn: '0', sapMessage: '', processedAt: '2026-07-04T10:00:00', ...over });

test('compareSapState: main success + staging success + rows present → ok', () => {
  const r = compareSapState({ type: 'R', mainSapStatus: 'success', period: 202607, stagingRows: [row()] });
  assert.equal(r.level, 'ok');
  assert.equal(r.rows[0].success, true);
});

test('compareSapState: main says success but NO staging rows for the period → mismatch', () => {
  const r = compareSapState({ type: 'R', mainSapStatus: 'success', period: 202607, stagingRows: [] });
  assert.equal(r.level, 'err');
  assert.match(r.detail, /no staging row/i);
});

test('compareSapState: main says success but staging row failed → mismatch', () => {
  const r = compareSapState({ type: 'P', mainSapStatus: 'success', period: 202607, stagingRows: [row({ sapReturn: 'E', sapMessage: 'timeout' })] });
  assert.equal(r.level, 'err');
  assert.match(r.detail, /staging shows fail/i);
});

test('compareSapState: main empty (not yet synced) + no staging rows → ok, still pending', () => {
  const r = compareSapState({ type: 'S', mainSapStatus: '', period: 202607, stagingRows: [] });
  assert.equal(r.level, 'warn');
  assert.match(r.detail, /not.*sync|pending/i);
});

test('compareSapState: main=fail matches staging fail → ok (expected state, not a mismatch)', () => {
  const r = compareSapState({ type: 'R', mainSapStatus: 'fail', period: 202607, stagingRows: [row({ sapReturn: 'X' })] });
  assert.equal(r.level, 'ok');
});

test('compareSapState: staging rows from a DIFFERENT period are ignored', () => {
  const r = compareSapState({ type: 'R', mainSapStatus: 'success', period: 202607, stagingRows: [row({ period: 202606 })] });
  assert.equal(r.level, 'err'); // treated as "no staging row this period"
});

test('compareSapState: Type P/S also reports contract number presence', () => {
  const r = compareSapState({ type: 'P', mainSapStatus: 'success', period: 202607, stagingRows: [row({ sapReturn: 'C', contractNo: 'CN-500' })] });
  assert.equal(r.rows[0].contractNo, 'CN-500');
  const rNoContract = compareSapState({ type: 'P', mainSapStatus: 'success', period: 202607, stagingRows: [row({ sapReturn: 'C', contractNo: '' })] });
  assert.equal(rNoContract.level, 'warn'); // synced but no contract number written
});

// ----------------------------------------------------------- orchestration --

const GUID = '11111111-1111-1111-1111-111111111111';
const DB = { server: 'localhost', sam: { database: 'SamDb' }, sap: { database: 'SapDb' } };

test('sapInspect wires proposal type/status/period → the right staging table', async () => {
  const readWide = async ({ database, sql }) => {
    if (/SELECT TOP 1/.test(sql)) return JSON.stringify({ id: GUID, groupId: 1, sapStatus: 'success', year: 2026, month: 7, requestNo: 'REQ', version: 1 });
    if (/FROM dbo\.CreateContract/.test(sql)) {
      assert.equal(database, 'SapDb');
      return JSON.stringify([{ id: 'r1', docNo: 'DOC1', period: 202607, sapReturn: 'C', sapMessage: '', contractNo: 'CN-1', processedAt: '2026-07-04T10:00:00' }]);
    }
    throw new Error('unexpected sql ' + sql.slice(0, 60));
  };
  const r = await sapInspect({ db: DB, proposalId: GUID, readWide });
  assert.equal(r.type, 'P');
  assert.equal(r.flow, 'CreateContract');
  assert.equal(r.comparison.level, 'ok');
});

test('sapInspect Type R has no contract table; guards GUID + dev server', async () => {
  const readWide = async ({ sql }) => {
    if (/SELECT TOP 1/.test(sql)) return JSON.stringify({ id: GUID, groupId: 2, sapStatus: '', year: 2026, month: 7, requestNo: 'REQ', version: 0 });
    if (/FROM dbo\.CreateDiscount/.test(sql)) return JSON.stringify([]);
    throw new Error('unexpected sql');
  };
  const r = await sapInspect({ db: DB, proposalId: GUID, readWide });
  assert.equal(r.flow, 'CreateDiscount');
  assert.equal(r.comparison.level, 'warn');

  await assert.rejects(() => sapInspect({ db: DB, proposalId: 'bad', readWide }), /GUID/i);
  await assert.rejects(() => sapInspect({ db: { ...DB, server: 'prod' }, proposalId: GUID, readWide }), /non-dev/i);
});
