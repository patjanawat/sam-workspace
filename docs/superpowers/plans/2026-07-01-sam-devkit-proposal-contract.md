# sam-devkit Proposal Contract (main-DB) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Extend sam-devkit with a dev-only "Proposal contract" fixup that writes the contract number into the **main SAM DB** the same two places real SAP sync does — the `ProposalProductTypeP.CONTRACT` column AND the `ProposalDetail.RebatePayload` JSON (`values.contract["col-N"].new`) — via direct `sqlcmd`. (Option C.)

**Architecture:** A new pure module `lib/json-contract.mjs` replicates the backend's product→col-index contract upsert on a parsed JSON object. A new orchestrator `lib/proposal-contract.mjs` does: validate → dev-guard → UPDATE the plain column → read `RebatePayload` (full value, `sqlcmd -y 0`), mutate JSON in Node, write it back via a temp `.sql` file (`sqlcmd -i`, avoids command-line length limits). A new `proposal-contract` server module + UI tab drive it. All work is under `tools/sam-devkit/`; **`web/` is never touched.**

**Tech Stack:** Node 18+ (ESM, `node:child_process`, `node:fs`, `node:os`, `node:test`), zero runtime deps, `sqlcmd`, SQL Server.

**Spec basis (verified against SAM codebase):**
- `Proposal.SAPStatus` and contract propagation: `web/.../Shared/SAP/SapSyncService.cs:254` (`p.CONTRACT = contractNo`) and `:261-265` (RebatePayload JSON upsert via `UpsertContractNewByProductId`).
- JSON shape: `web/.../Shared/JSON/Models/TypePPayloadRef.cs` (`Products: [{colId, productId}]`, `Values`), `PValues.cs` (`Contract: Dictionary<string,PTextCell>`), `PTextCell.cs` (`Old`, `New`).
- col-index rule: `web/.../Shared/JSON/Services/Implements/ProjectSectionBlockService.cs:8-44` — find product by `productId` in `Products` (Ordinal, trimmed), 1-based index → `col-{idx}`; set `Contract["col-{idx}"].New`.
- JSON serializer: `web/.../Shared/Helpers/JsonShared.cs` — **camelCase** property names + dictionary keys, `WriteIndented = true` (multi-line), `DefaultIgnoreCondition = WhenWritingNull`.
- Tables (main DB): `dbo.ProposalDetail` (`web/.../Database/SamAppDbContext.cs:660`; cols `Id, ProposalId, RebatePayload, SpecialPayload, AccumPayload`), `dbo.ProposalProductTypeP` (`:765`; `CONTRACT` nvarchar(16), keyed `PROPOSAL_ID`, `PRODUCT_CODE` nvarchar(16), `PAGE`).

## Global Constraints

- **Zero runtime dependencies** — Node built-ins + `sqlcmd` only.
- **Dev-only** — reuse `assertDevDbServer(db.server, db.allowedServers)`; refuse non-dev/unlisted servers.
- **No `web/` changes** — only `tools/sam-devkit/`.
- **camelCase JSON** — raw payload keys are camelCase: `products`, `productId`, `colId`, `values`, `contract`, `old`, `new`. Contract path: `values.contract["col-{idx}"].new`.
- **col-index rule** — 1-based position of the product in `products[]` matched by `productId` (Ordinal, trimmed). This mirrors the backend exactly; use position, not the product's own `colId`.
- **Type P only** — `ProposalProductTypeP` and the `values.contract` block exist only for Type P. Type R/S → nothing to write (report skipped).
- **Contract column is nvarchar(16)** — validate `contractNo` to `^[A-Za-z0-9_\-/]{1,16}$`. `productCode` (optional) to `^[A-Za-z0-9_\-/.]{1,16}$`.
- **SQL-injection defense** — validate before building SQL; single-quote-escape (`'`→`''`) every interpolated value; table/column names are literals in code.
- **Large-value I/O** — read `RebatePayload` with `sqlcmd -y 0` (unlimited var width, no truncation); write it back via a temp `.sql` file + `sqlcmd -i` (a multi-line/large JSON literal would overflow the `-Q` command line).
- **Test framework** — `node:test` + `node:assert/strict`, inject fakes (no real sqlcmd / DB / fs where possible). Run with `node --test` from `tools/sam-devkit/`.

**Branch:** already on `feature/sam-devkit-sap-fixup`. Continue on it (plain `git`, repo root, NOT `web/`). **Do not push** without user confirmation.

---

### Task 1: `lib/db.mjs` — `-y 0` for full reads + `-i` file execution

**Files:**
- Modify: `tools/sam-devkit/lib/db.mjs`
- Test: `tools/sam-devkit/test/db.test.mjs` (append)

**Interfaces:**
- Consumes: existing `runSql({server,database,user,password,sql,exec})`.
- Produces:
  - `runSql` now adds `-y`, `0` to the args (unlimited variable-length column width) so NVARCHAR(MAX) values are returned untruncated. Existing callers unaffected (rowcount/scalar reads still parse fine).
  - `runSqlFile({server,database,user,password,file,exec})` — runs `sqlcmd ... -i <file>` instead of `-Q`. For large/multi-line statements. Returns trimmed stdout; same error handling as `runSql`.

- [ ] **Step 1: Write the failing tests (append to db.test.mjs)**

```js
import { runSqlFile } from '../lib/db.mjs';

test('runSql includes -y 0 (untruncated variable-width output)', async () => {
  const rec = {};
  await runSql({ server: 'localhost', database: 'd', user: 'u', password: 'p', sql: 'SELECT 1;',
    exec: async (cmd, args) => { rec.args = args; return { stdout: '', stderr: '' }; } });
  const i = rec.args.indexOf('-y');
  assert.ok(i >= 0 && rec.args[i + 1] === '0', '-y 0 present');
});

test('runSqlFile uses -i <file> and returns trimmed stdout', async () => {
  const rec = {};
  const out = await runSqlFile({ server: 'localhost', database: 'd', user: 'u', password: 'p', file: '/tmp/x.sql',
    exec: async (cmd, args) => { rec.cmd = cmd; rec.args = args; return { stdout: 'ok\r\n', stderr: '' }; } });
  assert.equal(out, 'ok');
  assert.equal(rec.cmd, 'sqlcmd');
  const i = rec.args.indexOf('-i');
  assert.ok(i >= 0 && rec.args[i + 1] === '/tmp/x.sql', '-i file present');
  assert.ok(!rec.args.includes('-Q'), 'no -Q when running a file');
});

test('runSqlFile surfaces sqlcmd errors', async () => {
  const boom = async () => { const e = new Error('x'); e.stderr = 'Msg 208'; e.code = 1; throw e; };
  await assert.rejects(() => runSqlFile({ server: 'l', database: 'd', user: 'u', password: 'p', file: 'f', exec: boom }), /Msg 208/);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test test/db.test.mjs`
Expected: FAIL — `runSqlFile` not exported; `-y 0` assertion fails.

- [ ] **Step 3: Implement**

Rewrite `lib/db.mjs` to share arg-building and add the two behaviors:

```js
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

// -C trust cert · -b nonzero exit on SQL error · -h -1 no headers · -W trim · -y 0 untruncated var-width
const BASE = (server, database, user, password) =>
  ['-S', server, '-d', database, '-U', user, '-P', password, '-C', '-b', '-h', '-1', '-W', '-y', '0'];

async function invoke(args, exec) {
  try {
    const { stdout } = await exec('sqlcmd', args);
    return String(stdout).trim();
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error('sqlcmd not found on PATH — install SQL Server command-line tools');
    const detail = e.stderr ? String(e.stderr).trim() : e.message;
    const err = new Error(`sqlcmd failed: ${detail}`);
    err.code = e.code;
    throw err;
  }
}

export async function runSql({ server, database, user, password, sql, exec = execFileP }) {
  return invoke([...BASE(server, database, user, password), '-Q', sql], exec);
}

export async function runSqlFile({ server, database, user, password, file, exec = execFileP }) {
  return invoke([...BASE(server, database, user, password), '-i', file], exec);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/db.test.mjs`
Expected: PASS (existing db tests + 3 new). Then `node --test` full suite stays green.

- [ ] **Step 5: Commit**

```bash
git add tools/sam-devkit/lib/db.mjs tools/sam-devkit/test/db.test.mjs
git commit -m "feat(sam-devkit): db runner -y 0 (full reads) + runSqlFile (-i)"
```

---

### Task 2: `lib/json-contract.mjs` — pure JSON contract upsert

**Files:**
- Create: `tools/sam-devkit/lib/json-contract.mjs`
- Test: `tools/sam-devkit/test/json-contract.test.mjs`

**Interfaces:**
- Produces (all operate on a parsed payload object, camelCase keys, mutating in place):
  - `colIndexByProductId(payload, productId) => number` — 1-based position of the product in `payload.products` matched by `productId` (trimmed, exact); `-1` if not found.
  - `upsertContractByProductId(payload, productId, contractNo) => boolean` — sets `payload.values.contract["col-{idx}"].new = contractNo`; creates `values`/`contract`/cell as needed; returns `false` (no mutation) if product not found.
  - `upsertContractForAllProducts(payload, contractNo) => number` — applies to every product in `payload.products`; returns count updated.

- [ ] **Step 1: Write the failing tests**

```js
// tools/sam-devkit/test/json-contract.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colIndexByProductId, upsertContractByProductId, upsertContractForAllProducts } from '../lib/json-contract.mjs';

const sample = () => ({
  validFrom: '20260101', validTo: '20260131',
  products: [{ colId: 'col-1', productId: 'P100' }, { colId: 'col-2', productId: 'P200' }],
  values: { contract: { 'col-1': { old: null, new: '' } } },
});

test('colIndexByProductId returns 1-based position, -1 if missing', () => {
  const p = sample();
  assert.equal(colIndexByProductId(p, 'P100'), 1);
  assert.equal(colIndexByProductId(p, 'P200'), 2);
  assert.equal(colIndexByProductId(p, 'NOPE'), -1);
  assert.equal(colIndexByProductId(p, ' P200 '.trim()), 2);
});

test('upsertContractByProductId sets values.contract[col-N].new', () => {
  const p = sample();
  assert.equal(upsertContractByProductId(p, 'P200', 'C-9'), true);
  assert.equal(p.values.contract['col-2'].new, 'C-9');
});

test('upsertContractByProductId creates missing values/contract/cell', () => {
  const p = { products: [{ colId: 'col-1', productId: 'P100' }] }; // no values at all
  assert.equal(upsertContractByProductId(p, 'P100', 'C-1'), true);
  assert.equal(p.values.contract['col-1'].new, 'C-1');
});

test('upsertContractByProductId returns false for unknown product (no mutation)', () => {
  const p = sample();
  const before = JSON.stringify(p);
  assert.equal(upsertContractByProductId(p, 'ZZZ', 'C-1'), false);
  assert.equal(JSON.stringify(p), before);
});

test('upsertContractForAllProducts sets every product and returns count', () => {
  const p = sample();
  assert.equal(upsertContractForAllProducts(p, 'C-ALL'), 2);
  assert.equal(p.values.contract['col-1'].new, 'C-ALL');
  assert.equal(p.values.contract['col-2'].new, 'C-ALL');
});

test('upsertContractForAllProducts returns 0 when no products', () => {
  assert.equal(upsertContractForAllProducts({ products: [] }, 'C'), 0);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test test/json-contract.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
// tools/sam-devkit/lib/json-contract.mjs

// 1-based position of the product in payload.products, matched by productId (trimmed, exact). -1 if absent.
export function colIndexByProductId(payload, productId) {
  if (!productId) return -1;
  const key = String(productId).trim();
  const products = Array.isArray(payload?.products) ? payload.products : [];
  const idx = products.findIndex((p) => String(p?.productId ?? '').trim() === key);
  return idx >= 0 ? idx + 1 : -1;
}

function setCell(payload, colIndex, contractNo) {
  payload.values ??= {};
  payload.values.contract ??= {};
  const colId = `col-${colIndex}`;
  const cell = payload.values.contract[colId] ?? {};
  cell.new = contractNo ?? '';
  payload.values.contract[colId] = cell;
}

export function upsertContractByProductId(payload, productId, contractNo) {
  const idx = colIndexByProductId(payload, productId);
  if (idx <= 0) return false;
  setCell(payload, idx, contractNo);
  return true;
}

export function upsertContractForAllProducts(payload, contractNo) {
  const products = Array.isArray(payload?.products) ? payload.products : [];
  products.forEach((_, i) => setCell(payload, i + 1, contractNo));
  return products.length;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/json-contract.test.mjs`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add tools/sam-devkit/lib/json-contract.mjs tools/sam-devkit/test/json-contract.test.mjs
git commit -m "feat(sam-devkit): pure JSON contract upsert (product->col-N)"
```

---

### Task 3: `lib/proposal-contract.mjs` — orchestrator (column + JSON)

**Files:**
- Create: `tools/sam-devkit/lib/proposal-contract.mjs`
- Test: `tools/sam-devkit/test/proposal-contract.test.mjs`

**Interfaces:**
- Consumes: `assertDevDbServer` (guard.mjs), `runSql`/`runSqlFile` (db.mjs), `upsertContractByProductId`/`upsertContractForAllProducts` (json-contract.mjs).
- Produces: `setProposalContract({ db, proposalId, contractNo, productCode, run, runFile, writeTemp, log }) => Promise<{ column:{applied,rows,error?}, json:{applied,rows,updated,skippedReason?,error?} }>`.
  - `db` = `{server, sam:{...}, allowedServers}` (only the `sam` DB is used here — both writes are main-DB).
  - `run` defaults to `runSql`; `runFile` defaults to `runSqlFile`; `writeTemp` defaults to a real temp-file writer (injectable for tests) with signature `writeTemp(contents) => Promise<{path, cleanup}>`.
  - Validation throws fail-fast: proposalId GUID; contractNo `^[A-Za-z0-9_\-/]{1,16}$`; productCode (if provided) `^[A-Za-z0-9_\-/.]{1,16}$`.
  - Column and JSON are independent try/catch steps → partial success.

- [ ] **Step 1: Write the failing tests**

```js
// tools/sam-devkit/test/proposal-contract.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setProposalContract } from '../lib/proposal-contract.mjs';

const GUID = '11111111-1111-1111-1111-111111111111';
const db = { server: 'localhost', sam: { database: 'SamDb', user: 'sa', password: 'pw' }, allowedServers: [] };

const PAYLOAD = JSON.stringify({
  products: [{ colId: 'col-1', productId: 'P100' }, { colId: 'col-2', productId: 'P200' }],
  values: { contract: {} },
});

// fake temp writer: captures contents, returns a fake path + noop cleanup
function tempWriter() {
  const calls = [];
  return { calls, writeTemp: async (contents) => { calls.push(contents); return { path: '/tmp/fake.sql', cleanup: async () => {} }; } };
}

test('column step updates ProposalProductTypeP.CONTRACT (all products when no productCode)', async () => {
  const calls = [];
  const run = async ({ sql }) => { calls.push(sql); if (/UPDATE dbo\.ProposalProductTypeP/.test(sql)) return '2'; return PAYLOAD; };
  const runFile = async () => '1';
  const { writeTemp } = tempWriter();
  const r = await setProposalContract({ db, proposalId: GUID, contractNo: 'C-1', run, runFile, writeTemp });
  assert.equal(r.column.applied, true);
  assert.equal(r.column.rows, 2);
  const upd = calls.find((s) => /UPDATE dbo\.ProposalProductTypeP/.test(s));
  assert.match(upd, /SET CONTRACT='C-1' WHERE PROPOSAL_ID='11111111-/);
  assert.doesNotMatch(upd, /PRODUCT_CODE/); // no productCode → all rows
});

test('column step scopes to PRODUCT_CODE when productCode given', async () => {
  const calls = [];
  const run = async ({ sql }) => { calls.push(sql); if (/UPDATE dbo\.ProposalProductTypeP/.test(sql)) return '1'; return PAYLOAD; };
  const { writeTemp } = tempWriter();
  await setProposalContract({ db, proposalId: GUID, contractNo: 'C-1', productCode: 'P100', run, runFile: async () => '1', writeTemp });
  const upd = calls.find((s) => /UPDATE dbo\.ProposalProductTypeP/.test(s));
  assert.match(upd, /AND PRODUCT_CODE='P100'/);
});

test('json step reads RebatePayload, upserts by productCode, writes via temp file', async () => {
  const run = async ({ sql }) => (/SELECT RebatePayload/.test(sql) ? PAYLOAD : '1');
  const runFile = async () => '1';
  const tw = tempWriter();
  const r = await setProposalContract({ db, proposalId: GUID, contractNo: 'C-9', productCode: 'P200', run, runFile, writeTemp: tw.writeTemp });
  assert.equal(r.json.applied, true);
  assert.equal(r.json.updated, 1);
  // the temp .sql contains the UPDATE with the new contract embedded in the JSON
  const sqlWritten = tw.calls[0];
  assert.match(sqlWritten, /UPDATE dbo\.ProposalDetail SET RebatePayload=/);
  assert.match(sqlWritten, /col-2/);
  assert.match(sqlWritten, /C-9/);
});

test('json step: product not found → skipped with reason, column still applied', async () => {
  const run = async ({ sql }) => (/SELECT RebatePayload/.test(sql) ? PAYLOAD : '1');
  const tw = tempWriter();
  const r = await setProposalContract({ db, proposalId: GUID, contractNo: 'C-1', productCode: 'ZZZ', run, runFile: async () => '1', writeTemp: tw.writeTemp });
  assert.equal(r.json.applied, false);
  assert.match(r.json.skippedReason, /not found/i);
  assert.equal(tw.calls.length, 0); // never wrote a temp file
});

test('json step: empty RebatePayload → skipped', async () => {
  const run = async ({ sql }) => (/SELECT RebatePayload/.test(sql) ? '' : '1');
  const tw = tempWriter();
  const r = await setProposalContract({ db, proposalId: GUID, contractNo: 'C-1', run, runFile: async () => '1', writeTemp: tw.writeTemp });
  assert.equal(r.json.applied, false);
  assert.match(r.json.skippedReason, /no RebatePayload|not found/i);
});

test('partial success: column throws, json still runs', async () => {
  const run = async ({ sql }) => {
    if (/UPDATE dbo\.ProposalProductTypeP/.test(sql)) throw new Error('col boom');
    if (/SELECT RebatePayload/.test(sql)) return PAYLOAD;
    return '1';
  };
  const tw = tempWriter();
  const r = await setProposalContract({ db, proposalId: GUID, contractNo: 'C-1', run, runFile: async () => '1', writeTemp: tw.writeTemp });
  assert.equal(r.column.applied, false);
  assert.match(r.column.error, /col boom/);
  assert.equal(r.json.applied, true);
});

test('rejects bad proposalId / contractNo / productCode / nothing', async () => {
  await assert.rejects(() => setProposalContract({ db, proposalId: 'x', contractNo: 'C-1' }), /GUID/i);
  await assert.rejects(() => setProposalContract({ db, proposalId: GUID, contractNo: "bad'; DROP" }), /contractNo/);
  await assert.rejects(() => setProposalContract({ db, proposalId: GUID, contractNo: 'C-1', productCode: "x'y" }), /productCode/);
  await assert.rejects(() => setProposalContract({ db, proposalId: GUID }), /contractNo/);
});

test('rejects non-dev server before any DB write', async () => {
  const prodDb = { ...db, server: 'sql-prod-01' };
  await assert.rejects(() => setProposalContract({ db: prodDb, proposalId: GUID, contractNo: 'C-1', run: async () => '1', runFile: async () => '1' }), /non-dev db server/i);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test test/proposal-contract.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```js
// tools/sam-devkit/lib/proposal-contract.mjs
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertDevDbServer } from './guard.mjs';
import { runSql, runSqlFile } from './db.mjs';
import { upsertContractByProductId, upsertContractForAllProducts } from './json-contract.mjs';

const GUID_RE = /^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$/;
const CONTRACT_RE = /^[A-Za-z0-9_\-/]{1,16}$/;   // ProposalProductTypeP.CONTRACT is nvarchar(16)
const PRODUCT_RE = /^[A-Za-z0-9_\-/.]{1,16}$/;

const esc = (v) => String(v).replace(/'/g, "''");
const rows = (out) => Number(String(out).trim()) || 0;

// default temp writer: writes a UTF-8 .sql file, returns its path + a cleanup fn
async function defaultWriteTemp(contents) {
  // Date.now/Math.random are unavailable in some sandboxes but this file runs in the real server process.
  const path = join(tmpdir(), `sam-devkit-${process.pid}-${Date.now()}.sql`);
  await writeFile(path, contents, 'utf8');
  return { path, cleanup: () => unlink(path).catch(() => {}) };
}

export async function setProposalContract({
  db, proposalId, contractNo, productCode,
  run = runSql, runFile = runSqlFile, writeTemp = defaultWriteTemp, log = () => {},
}) {
  if (!GUID_RE.test(proposalId || '')) throw new Error(`Invalid proposalId (must be GUID): ${proposalId}`);
  if (contractNo === undefined || contractNo === null || contractNo === '') throw new Error('contractNo is required');
  if (!CONTRACT_RE.test(contractNo)) throw new Error(`Invalid contractNo "${contractNo}" (max 16, [A-Za-z0-9_-/])`);
  const hasProduct = productCode !== undefined && productCode !== null && productCode !== '';
  if (hasProduct && !PRODUCT_RE.test(productCode)) throw new Error(`Invalid productCode "${productCode}"`);

  assertDevDbServer(db.server, db.allowedServers);

  const sam = { server: db.server, ...db.sam };
  const id = esc(proposalId);
  const c = esc(contractNo);
  const result = { column: { applied: false, rows: 0 }, json: { applied: false, rows: 0, updated: 0, skippedReason: null } };

  // --- Step 1: plain column ProposalProductTypeP.CONTRACT ---
  try {
    const where = hasProduct
      ? `PROPOSAL_ID='${id}' AND PRODUCT_CODE='${esc(productCode)}'`
      : `PROPOSAL_ID='${id}'`;
    log(`update ProposalProductTypeP.CONTRACT='${contractNo}' where ${hasProduct ? `product ${productCode}` : 'all products'}`);
    const out = await run({ ...sam, sql: `SET NOCOUNT ON; UPDATE dbo.ProposalProductTypeP SET CONTRACT='${c}' WHERE ${where}; SELECT @@ROWCOUNT;` });
    result.column = { applied: true, rows: rows(out) };
    log(`  rows affected: ${result.column.rows}`);
  } catch (e) {
    result.column = { applied: false, rows: 0, error: e.message };
    log(`  column FAILED: ${e.message}`);
  }

  // --- Step 2: RebatePayload JSON ---
  try {
    log('read ProposalDetail.RebatePayload');
    const payloadJson = await run({ ...sam, sql: `SET NOCOUNT ON; SELECT RebatePayload FROM dbo.ProposalDetail WHERE ProposalId='${id}';` });
    if (!payloadJson || !payloadJson.trim()) {
      result.json.skippedReason = 'no RebatePayload (detail missing or empty)';
      log(`  json skipped: ${result.json.skippedReason}`);
    } else {
      const payload = JSON.parse(payloadJson);
      let updated;
      if (hasProduct) {
        updated = upsertContractByProductId(payload, productCode, contractNo) ? 1 : 0;
        if (updated === 0) {
          result.json.skippedReason = `product ${productCode} not found in payload`;
          log(`  json skipped: ${result.json.skippedReason}`);
        }
      } else {
        updated = upsertContractForAllProducts(payload, contractNo);
        if (updated === 0) result.json.skippedReason = 'no products in payload';
      }
      if (updated > 0) {
        const newJson = JSON.stringify(payload);
        const sql = `SET NOCOUNT ON; UPDATE dbo.ProposalDetail SET RebatePayload='${esc(newJson)}' WHERE ProposalId='${id}'; SELECT @@ROWCOUNT;`;
        const tmp = await writeTemp(sql);
        try {
          const out = await runFile({ ...sam, file: tmp.path });
          result.json = { applied: true, rows: rows(out), updated, skippedReason: null };
          log(`  json rows affected: ${result.json.rows} (products updated: ${updated})`);
        } finally {
          await tmp.cleanup();
        }
      }
    }
  } catch (e) {
    result.json = { ...result.json, applied: false, error: e.message };
    log(`  json FAILED: ${e.message}`);
  }

  return result;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test test/proposal-contract.test.mjs`
Expected: PASS (all tests). Then `node --test` full suite green.

- [ ] **Step 5: Commit**

```bash
git add tools/sam-devkit/lib/proposal-contract.mjs tools/sam-devkit/test/proposal-contract.test.mjs
git commit -m "feat(sam-devkit): setProposalContract (main-DB column + RebatePayload JSON)"
```

---

### Task 4: `server.mjs` — wire the `proposal-contract` module

**Files:**
- Modify: `tools/sam-devkit/server.mjs`

**Interfaces:**
- Consumes: `loadDbConfig` (config.mjs), `setProposalContract` (proposal-contract.mjs).
- Produces: `POST /run` with `{ module:'proposal-contract', proposalId, contractNo, productCode? }` streams per-step log then `RESULT <json>`; DB/validation errors → `ERROR ...`; no login.

- [ ] **Step 1: Add the import**

Add beside the other `lib/*` imports:
```js
import { setProposalContract } from './lib/proposal-contract.mjs';
```

- [ ] **Step 2: Add the branch (next to the existing `sap-fixup` branch, same shape)**

```js
  if (module === 'proposal-contract') {
    try {
      const db = loadDbConfig(cfg);
      const r = await setProposalContract({
        db,
        proposalId: input.proposalId,
        contractNo: input.contractNo,
        productCode: input.productCode,
        log,
      });
      res.write('RESULT ' + JSON.stringify(r) + '\n');
    } catch (e) {
      const detail = e.bodyText ? ` — ${e.bodyText}` : '';
      res.write(`ERROR ${e.name || 'Error'}: ${e.message}${detail}\n`);
    }
    return res.end();
  }
```

- [ ] **Step 3: Smoke check**

`node server.mjs` (or `PORT=8790 node server.mjs`), then:
`curl -s -X POST localhost:8787/run -H "Content-Type: application/json" -d '{"module":"proposal-contract","proposalId":"x","contractNo":"C-1"}'`
Expected: `ERROR Error: Invalid proposalId (must be GUID): x` — proves the branch is reached and validates. (If no dev DB, a missing `db` block prints the missing-db error — also proves wiring.) Stop the server after.

- [ ] **Step 4: Full suite**

Run: `node --test` — no regressions.

- [ ] **Step 5: Commit**

```bash
git add tools/sam-devkit/server.mjs
git commit -m "feat(sam-devkit): expose proposal-contract module in server"
```

---

### Task 5: `index.html` — Proposal contract tab

**Files:**
- Modify: `tools/sam-devkit/index.html`

**Interfaces:** posts `{ module:'proposal-contract', apiBaseUrl, proposalId, contractNo, productCode? }` via `stream()`; omits `productCode` when blank.

- [ ] **Step 1: Nav button** (after the SAP fixup button):
```html
  <button data-tab="pcontract">Proposal contract</button>
```

- [ ] **Step 2: Section** (after `<section id="tab-sapfix">…</section>`):
```html
<section id="tab-pcontract" hidden>
  <label>Proposal ID (guid)</label><input id="pc-proposalId">
  <label>Contract number (max 16)</label><input id="pc-contractNo">
  <label>Product code (optional — blank = all products)</label><input id="pc-productCode">
  <button id="pc-run">Run proposal contract</button>
</section>
```

- [ ] **Step 3: Register in `show()`** — change the tab list to:
```js
    for (const s of ['approve', 'clone', 'create', 'sapfix', 'pcontract']) $('tab-' + s).hidden = (s !== tab);
```

- [ ] **Step 4: Wire the button** (after the `$('sf-run')` handler):
```js
  $('pc-run').onclick = () => {
    const body = { module: 'proposal-contract', apiBaseUrl: $('apiBaseUrl').value,
      proposalId: $('pc-proposalId').value, contractNo: $('pc-contractNo').value.trim() };
    const pcode = $('pc-productCode').value.trim();
    if (pcode) body.productCode = pcode;
    stream(body);
  };
```

- [ ] **Step 5: Verify** — `node server.mjs`, GET the page, confirm `tab-pcontract` + `pc-run` present; if a browser is available, click the tab and confirm switch + bad-guid ERROR streams. Note if browser test skipped.

- [ ] **Step 6: Commit**

```bash
git add tools/sam-devkit/index.html
git commit -m "feat(sam-devkit): Proposal contract UI tab"
```

---

### Task 6: README

**Files:**
- Modify: `tools/sam-devkit/README.md`

- [ ] **Step 1: Document the module** (new subsection under SAP fixup):

```markdown
## Proposal contract (main DB — dev only)

Writes the contract number into the **main SAM DB** the two places a real SAP sync does,
so a proposal looks synced without contacting SAP:
- `dbo.ProposalProductTypeP.CONTRACT` (plain column, nvarchar(16))
- `dbo.ProposalDetail.RebatePayload` JSON at `values.contract["col-N"].new` (N = the product's
  1-based position in `products[]`)

**Inputs:** Proposal ID, Contract number (≤16 chars), optional Product code.
- With a **Product code**: only that product's column row and its `col-N` JSON cell are set.
- **Blank** Product code: applies to **all** Type P products (all matching column rows + every `col-N`).

**Type P only.** Type R/S have no `ProposalProductTypeP` rows / contract JSON block → nothing to write.

**Notes**
- Reads `RebatePayload` untruncated (`sqlcmd -y 0`) and writes it back via a temp `.sql` file
  (`sqlcmd -i`) so large/multi-line JSON isn't limited by the command line.
- Re-serialising the JSON may change whitespace/formatting but not meaning (the backend parses
  case-insensitively and ignores indentation).
- Same dev-only DB guard and `db.allowedServers` allowlist as the SAP fixup module.
```

- [ ] **Step 2: Full suite** — `node --test` (docs only, stays green).

- [ ] **Step 3: Commit**

```bash
git add tools/sam-devkit/README.md
git commit -m "docs(sam-devkit): document Proposal contract module"
```

---

## Self-Review

**Spec coverage:** Column write (ProposalProductTypeP.CONTRACT) → Task 3 step 1. JSON write (RebatePayload values.contract[col-N].new) → Task 2 (logic) + Task 3 step 2. col-index rule (position+1, camelCase) → Task 2. Large-value read (`-y 0`) + large write (`-i` temp file) → Task 1 + Task 3. Dev guard + allowlist → Task 3 (reuses guard). Type-P-only / not-found skips → Task 3 tests. Server + UI + README → Tasks 4-6. All covered.

**Placeholder scan:** none — every code step is complete.

**Type consistency:** `runSql`/`runSqlFile` signatures match Task 1 defs and Task 3 usage. `setProposalContract` signature identical in Task 3 interface, impl, and Task 4 call site. `upsertContractByProductId`/`upsertContractForAllProducts`/`colIndexByProductId` names identical across Task 2 def and Task 3 import. Contract path `values.contract["col-N"].new` consistent (Task 2 impl, Task 3 test assertions, README).

---

## Execution Handoff

Order: 1 → 2 → 3 → 4 → 5 → 6 (3 depends on 1+2; 4 depends on 3). Full-suite gate at Tasks 4 and 6, plus a final whole-branch review.
Subagent-driven per task (implementer haiku for transcription tasks 1,2,4,5,6; sonnet for the Task 3 orchestrator; sonnet reviewers; opus final review).
