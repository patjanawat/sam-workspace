# sam-devkit SAP fixup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dev-only sam-devkit module that force-sets a proposal's SAP status (main DB) and contract number (SAP DB) via direct `sqlcmd`, bypassing real SAP.

**Architecture:** New `lib/db.mjs` runs `sqlcmd` through an injectable `child_process` wrapper; `lib/sap-fixup.mjs` validates input, updates `Proposal.SAPStatus` on the main DB, auto-detects the proposal type to pick the contract table, and updates it on the SAP DB. `server.mjs` exposes a `sap-fixup` module (no login — direct DB); `index.html` gets a tab. All work is in `tools/sam-devkit/`; **`web/` is never touched.**

**Tech Stack:** Node 18+ (ESM, `node:child_process`, `node:test`), zero runtime dependencies, `sqlcmd` CLI, SQL Server.

**Spec:** `docs/superpowers/specs/2026-07-01-sam-devkit-sap-fixup-design.md`

## Global Constraints

- **Zero runtime dependencies** — no `npm install`; only Node built-ins + `sqlcmd` on PATH.
- **Dev-only** — every DB write is guarded by `assertDevDbServer`; refuse non-dev servers.
- **No `web/` changes** — plan touches only `tools/sam-devkit/`.
- **SQL-injection defense** — validate every value (GUID / status enum / contract regex) before building SQL; single-quote-escape (`'`→`''`) as defense-in-depth. Table/column names come only from a hardcoded whitelist map, never from input.
- **Test framework** — `import { test } from 'node:test'` + `import assert from 'node:assert/strict'`; inject fakes (no live DB, no real `sqlcmd`). Run with `node --test` from `tools/sam-devkit/`.
- **proposalGroupId mapping** — P=1, R=2, S=3 (matches `lib/constants.mjs`).
- **Status values** — `success` / `fail` / `""` (clear). **Contract tables** — P→`CreateContract.SAP_CONTRACT_NO`, S→`ChangeContract.CONTRACT_NO`, R→none.

**Branch (do first):** `git checkout -b feature/sam-devkit-sap-fixup` (in `sam-workspace` repo root — this is NOT `web/`, use plain `git`). Commit steps below are within this branch; **do not push without user confirmation.**

---

### Task 1: `lib/db.mjs` — sqlcmd runner

**Files:**
- Create: `tools/sam-devkit/lib/db.mjs`
- Test: `tools/sam-devkit/test/db.test.mjs`

**Interfaces:**
- Produces: `runSql({ server, database, user, password, sql, exec? }) => Promise<string>` — returns trimmed stdout; throws `Error` (with `.code`) on failure. `exec` defaults to a promisified `execFile` and is injectable for tests. Signature `exec(cmd, args) => Promise<{ stdout, stderr }>`.

- [ ] **Step 1: Write the failing test**

```js
// tools/sam-devkit/test/db.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSql } from '../lib/db.mjs';

function fakeExec(record, result) {
  return async (cmd, args) => { record.cmd = cmd; record.args = args; return result; };
}

test('builds sqlcmd args array (no shell string) and returns trimmed stdout', async () => {
  const rec = {};
  const out = await runSql({
    server: 'localhost', database: 'SamDb', user: 'sa', password: 'pw',
    sql: 'SELECT 1;', exec: fakeExec(rec, { stdout: '1\r\n', stderr: '' }),
  });
  assert.equal(out, '1');
  assert.equal(rec.cmd, 'sqlcmd');
  assert.deepEqual(rec.args, ['-S', 'localhost', '-d', 'SamDb', '-U', 'sa', '-P', 'pw', '-C', '-b', '-h', '-1', '-W', '-Q', 'SELECT 1;']);
});

test('nonzero exit throws with stderr text', async () => {
  const boom = async () => { const e = new Error('exit 1'); e.stderr = 'Msg 208 invalid object'; e.code = 1; throw e; };
  await assert.rejects(
    () => runSql({ server: 'localhost', database: 'd', user: 'u', password: 'p', sql: 'x', exec: boom }),
    /invalid object/,
  );
});

test('missing sqlcmd (ENOENT) throws a clear not-found error', async () => {
  const enoent = async () => { const e = new Error('spawn sqlcmd ENOENT'); e.code = 'ENOENT'; throw e; };
  await assert.rejects(
    () => runSql({ server: 'localhost', database: 'd', user: 'u', password: 'p', sql: 'x', exec: enoent }),
    /sqlcmd not found/i,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/db.test.mjs` (from `tools/sam-devkit/`)
Expected: FAIL — `Cannot find module '../lib/db.mjs'`.

- [ ] **Step 3: Write minimal implementation**

```js
// tools/sam-devkit/lib/db.mjs
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

export async function runSql({ server, database, user, password, sql, exec = execFileP }) {
  const args = ['-S', server, '-d', database, '-U', user, '-P', password, '-C', '-b', '-h', '-1', '-W', '-Q', sql];
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/db.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add tools/sam-devkit/lib/db.mjs tools/sam-devkit/test/db.test.mjs
git commit -m "feat(sam-devkit): sqlcmd runner (lib/db.mjs)"
```

---

### Task 2: `lib/guard.mjs` — `assertDevDbServer`

**Files:**
- Modify: `tools/sam-devkit/lib/guard.mjs` (append export)
- Test: `tools/sam-devkit/test/guard.test.mjs` (append cases)

**Interfaces:**
- Consumes: existing `assertDevHost` (unchanged).
- Produces: `assertDevDbServer(server)` — throws unless `server` resolves to a dev host. Accepts SQL Server forms: `localhost`, `127.0.0.1`, `::1`, `(local)`, `.`, `*.local`, and strips `,port` and `\INSTANCE` suffixes before checking.

- [ ] **Step 1: Write the failing test (append to guard.test.mjs)**

```js
// append to tools/sam-devkit/test/guard.test.mjs
import { assertDevDbServer } from '../lib/guard.mjs';

test('assertDevDbServer accepts dev servers incl. port/instance forms', () => {
  for (const s of ['localhost', '127.0.0.1', 'localhost,1433', 'localhost\\SQLEXPRESS', '(local)', '.', 'db.local']) {
    assert.doesNotThrow(() => assertDevDbServer(s));
  }
});

test('assertDevDbServer rejects remote/prod servers', () => {
  for (const s of ['sql.prod.example.com', '10.0.0.5', 'prod-sql,1433']) {
    assert.throws(() => assertDevDbServer(s), /non-dev db server/i);
  }
});

test('assertDevDbServer rejects empty', () => {
  assert.throws(() => assertDevDbServer(''), /required/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/guard.test.mjs`
Expected: FAIL — `assertDevDbServer is not a function` / not exported.

- [ ] **Step 3: Write minimal implementation (append to guard.mjs)**

```js
// append to tools/sam-devkit/lib/guard.mjs
const DEV_DB_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '(local)', '.']);

export function assertDevDbServer(server) {
  if (!server || typeof server !== 'string') throw new Error('db.server is required');
  const host = server.split(',')[0].split('\\')[0].trim().toLowerCase();
  const isDev = DEV_DB_HOSTS.has(host) || host.endsWith('.local');
  if (!isDev) {
    throw new Error(`Refusing to run against non-dev DB server "${server}". sam-devkit is dev-only.`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/guard.test.mjs`
Expected: PASS (existing 3 + new 3).

- [ ] **Step 5: Commit**

```bash
git add tools/sam-devkit/lib/guard.mjs tools/sam-devkit/test/guard.test.mjs
git commit -m "feat(sam-devkit): dev-only DB server guard"
```

---

### Task 3: `lib/config.mjs` — `loadDbConfig` + pass-through `db`

**Files:**
- Modify: `tools/sam-devkit/lib/config.mjs`
- Test: `tools/sam-devkit/test/config.test.mjs` (append cases)

**Interfaces:**
- Consumes: existing `loadConfig(raw)`.
- Produces:
  - `loadConfig(raw)` now returns `{ apiBaseUrl, roles, db }` where `db = raw.db` (may be `undefined`; **not** validated here — API-only flows keep working).
  - `loadDbConfig(cfg)` — reads `cfg.db`; validates `db.server` and `db.sam` / `db.sap` each `{ database, user, password }`; returns `{ server, sam, sap }`. Throws with a message naming the missing piece.

- [ ] **Step 1: Write the failing test (append to config.test.mjs)**

```js
// append to tools/sam-devkit/test/config.test.mjs
import { loadDbConfig } from '../lib/config.mjs';

const goodDb = {
  ...good,
  db: {
    server: 'localhost',
    sam: { database: 'SamDb', user: 'sa', password: 'pw' },
    sap: { database: 'SamSapDb', user: 'sa', password: 'pw' },
  },
};

test('loadConfig passes db block through without requiring it', () => {
  assert.equal(loadConfig(good).db, undefined);        // no db block is fine
  assert.equal(loadConfig(goodDb).db.server, 'localhost');
});

test('loadDbConfig accepts a valid db block', () => {
  const db = loadDbConfig(loadConfig(goodDb));
  assert.equal(db.server, 'localhost');
  assert.equal(db.sap.database, 'SamSapDb');
});

test('loadDbConfig throws when db block missing', () => {
  assert.throws(() => loadDbConfig(loadConfig(good)), /db/);
});

test('loadDbConfig throws naming a missing sub-field', () => {
  const bad = { ...goodDb, db: { ...goodDb.db, sap: { database: 'x', user: 'y' } } };
  assert.throws(() => loadDbConfig(bad), /sap/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/config.test.mjs`
Expected: FAIL — `loadDbConfig is not a function` / export missing.

- [ ] **Step 3: Write minimal implementation**

Edit `lib/config.mjs`: change the `loadConfig` return line and append `loadDbConfig`.

```js
// change the return of loadConfig from:
//   return { apiBaseUrl: raw.apiBaseUrl, roles: raw.roles };
// to:
  return { apiBaseUrl: raw.apiBaseUrl, roles: raw.roles, db: raw.db };
}

export function loadDbConfig(cfg) {
  const db = cfg && cfg.db;
  if (!db || typeof db !== 'object') throw new Error('config.json: missing "db" block (required for sap-fixup)');
  if (!db.server) throw new Error('config.json: db.server is required');
  for (const key of ['sam', 'sap']) {
    const d = db[key];
    if (!d || !d.database || !d.user || !d.password) {
      throw new Error(`config.json: db.${key} needs { database, user, password }`);
    }
  }
  return { server: db.server, sam: db.sam, sap: db.sap };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/config.test.mjs`
Expected: PASS (existing 4 + new 4).

- [ ] **Step 5: Commit**

```bash
git add tools/sam-devkit/lib/config.mjs tools/sam-devkit/test/config.test.mjs
git commit -m "feat(sam-devkit): optional db config + loadDbConfig"
```

---

### Task 4: `lib/sap-fixup.mjs` — orchestrator

**Files:**
- Create: `tools/sam-devkit/lib/sap-fixup.mjs`
- Test: `tools/sam-devkit/test/sap-fixup.test.mjs`

**Interfaces:**
- Consumes: `assertDevDbServer` (Task 2), `runSql` (Task 1, injectable as `run`).
- Produces: `setSapState({ db, proposalId, sapStatus?, contractNo?, run?, log? }) => Promise<{ status:{applied,rows,error?}, contract:{applied,table,rows,skippedReason?,error?} }>`.
  - `db` shape: `{ server, sam:{database,user,password}, sap:{database,user,password} }` (from `loadDbConfig`).
  - `run` defaults to `runSql`; signature `run({ server, database, user, password, sql }) => Promise<string>`.
  - Validation throws (fail-fast) for bad `proposalId` / `sapStatus` / `contractNo` / nothing-to-update. Per-step DB errors are caught and reported in the result (partial success).

- [ ] **Step 1: Write the failing test**

```js
// tools/sam-devkit/test/sap-fixup.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setSapState } from '../lib/sap-fixup.mjs';

const GUID = '11111111-1111-1111-1111-111111111111';
const db = {
  server: 'localhost',
  sam: { database: 'SamDb', user: 'sa', password: 'pw' },
  sap: { database: 'SapDb', user: 'sa', password: 'pw' },
};

// fake runner: records every sql; returns queued outputs in order
function runner(outputs) {
  const calls = [];
  const q = [...outputs];
  const run = async ({ database, sql }) => { calls.push({ database, sql }); return q.shift(); };
  return { run, calls };
}

test('status-only updates Proposal on sam db and reports rows', async () => {
  const { run, calls } = runner(['1']);
  const r = await setSapState({ db, proposalId: GUID, sapStatus: 'success', run });
  assert.equal(r.status.applied, true);
  assert.equal(r.status.rows, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].database, 'SamDb');
  assert.match(calls[0].sql, /UPDATE Proposal SET SAPStatus='success' WHERE Id='11111111-/);
});

test('contract update auto-detects Type P -> CreateContract.SAP_CONTRACT_NO on sap db', async () => {
  const { run, calls } = runner(['1', '2']); // [type lookup=1(P), update rowcount=2]
  const r = await setSapState({ db, proposalId: GUID, contractNo: 'C-500', run });
  assert.equal(r.contract.applied, true);
  assert.equal(r.contract.table, 'CreateContract');
  assert.equal(r.contract.rows, 2);
  assert.match(calls[0].sql, /SELECT ProposalGroupId FROM Proposal/);
  assert.equal(calls[1].database, 'SapDb');
  assert.match(calls[1].sql, /UPDATE CreateContract SET SAP_CONTRACT_NO='C-500' WHERE PROPOSAL_ID='11111111-/);
});

test('Type S -> ChangeContract.CONTRACT_NO', async () => {
  const { run, calls } = runner(['3', '1']); // type=3(S)
  const r = await setSapState({ db, proposalId: GUID, contractNo: 'C-9', run });
  assert.equal(r.contract.table, 'ChangeContract');
  assert.match(calls[1].sql, /UPDATE ChangeContract SET CONTRACT_NO='C-9'/);
});

test('Type R skips contract with a reason, but status still applied', async () => {
  const { run, calls } = runner(['1', '2']); // status update=1row, then type lookup=2(R)
  const r = await setSapState({ db, proposalId: GUID, sapStatus: 'fail', contractNo: 'C-1', run });
  assert.equal(r.status.applied, true);
  assert.equal(r.contract.applied, false);
  assert.match(r.contract.skippedReason, /no SAP contract table/i);
  assert.equal(calls.length, 2); // status update + type lookup; no contract UPDATE
});

test('proposal not found -> contract skipped with reason', async () => {
  const { run } = runner(['']); // empty type lookup
  const r = await setSapState({ db, proposalId: GUID, contractNo: 'C-1', run });
  assert.equal(r.contract.applied, false);
  assert.match(r.contract.skippedReason, /not found/i);
});

test('partial success: status ok, contract runner throws -> reported per-step', async () => {
  let n = 0;
  const run = async ({ sql }) => {
    n++;
    if (/UPDATE Proposal/.test(sql)) return '1';
    throw new Error('boom on lookup');
  };
  const r = await setSapState({ db, proposalId: GUID, sapStatus: 'success', contractNo: 'C-1', run });
  assert.equal(r.status.applied, true);
  assert.equal(r.contract.applied, false);
  assert.match(r.contract.error, /boom/);
});

test('rejects bad proposalId', async () => {
  await assert.rejects(() => setSapState({ db, proposalId: 'nope', sapStatus: 'success' }), /GUID/i);
});

test('rejects bad sapStatus', async () => {
  await assert.rejects(() => setSapState({ db, proposalId: GUID, sapStatus: 'weird', run: async () => '1' }), /sapStatus/);
});

test('rejects bad contractNo', async () => {
  await assert.rejects(() => setSapState({ db, proposalId: GUID, contractNo: "x'; DROP--", run: async () => '1' }), /contractNo/);
});

test('rejects nothing-to-update', async () => {
  await assert.rejects(() => setSapState({ db, proposalId: GUID, run: async () => '1' }), /nothing to update/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/sap-fixup.test.mjs`
Expected: FAIL — `Cannot find module '../lib/sap-fixup.mjs'`.

- [ ] **Step 3: Write minimal implementation**

```js
// tools/sam-devkit/lib/sap-fixup.mjs
import { assertDevDbServer } from './guard.mjs';
import { runSql } from './db.mjs';

const GUID_RE = /^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$/;
const STATUS_VALUES = new Set(['success', 'fail', '']);
const CONTRACT_RE = /^[A-Za-z0-9_\-/]{0,50}$/;

// whitelist — table/column names are never taken from user input
const CONTRACT_TABLE = {
  1: { table: 'CreateContract', col: 'SAP_CONTRACT_NO' }, // Type P
  3: { table: 'ChangeContract', col: 'CONTRACT_NO' },     // Type S
};

const esc = (v) => String(v).replace(/'/g, "''");
const rows = (out) => Number(String(out).trim()) || 0;

export async function setSapState({ db, proposalId, sapStatus, contractNo, run = runSql, log = () => {} }) {
  if (!GUID_RE.test(proposalId || '')) throw new Error(`Invalid proposalId (must be GUID): ${proposalId}`);
  const hasStatus = sapStatus !== undefined;
  const hasContract = contractNo !== undefined && contractNo !== '';
  if (!hasStatus && !hasContract) throw new Error('nothing to update: provide sapStatus and/or contractNo');
  if (hasStatus && !STATUS_VALUES.has(sapStatus)) throw new Error(`Invalid sapStatus "${sapStatus}" (expected success, fail, or "")`);
  if (hasContract && !CONTRACT_RE.test(contractNo)) throw new Error(`Invalid contractNo "${contractNo}"`);

  assertDevDbServer(db.server);

  const result = {
    status: { applied: false, rows: 0 },
    contract: { applied: false, table: null, rows: 0, skippedReason: null },
  };
  const sam = { server: db.server, ...db.sam };
  const sap = { server: db.server, ...db.sap };
  const id = esc(proposalId);

  if (hasStatus) {
    try {
      log(`set Proposal.SAPStatus='${sapStatus}' where Id=${proposalId}`);
      const out = await run({ ...sam, sql: `SET NOCOUNT ON; UPDATE Proposal SET SAPStatus='${esc(sapStatus)}' WHERE Id='${id}'; SELECT @@ROWCOUNT;` });
      result.status = { applied: true, rows: rows(out) };
      log(`  rows affected: ${result.status.rows}`);
    } catch (e) {
      result.status = { applied: false, rows: 0, error: e.message };
      log(`  status FAILED: ${e.message}`);
    }
  }

  if (hasContract) {
    try {
      log('lookup proposal type');
      const typeOut = await run({ ...sam, sql: `SET NOCOUNT ON; SELECT ProposalGroupId FROM Proposal WHERE Id='${id}';` });
      const groupId = Number(String(typeOut).trim());
      if (!groupId) {
        result.contract.skippedReason = 'proposal not found';
        log('  contract skipped: proposal not found');
      } else if (!CONTRACT_TABLE[groupId]) {
        result.contract.skippedReason = `ProposalGroupId=${groupId} has no SAP contract table`;
        log(`  contract skipped: ${result.contract.skippedReason}`);
      } else {
        const { table, col } = CONTRACT_TABLE[groupId];
        log(`set ${table}.${col}='${contractNo}' where PROPOSAL_ID=${proposalId}`);
        const out = await run({ ...sap, sql: `SET NOCOUNT ON; UPDATE ${table} SET ${col}='${esc(contractNo)}' WHERE PROPOSAL_ID='${id}'; SELECT @@ROWCOUNT;` });
        result.contract = { applied: true, table, rows: rows(out), skippedReason: null };
        log(`  rows affected: ${result.contract.rows}`);
      }
    } catch (e) {
      result.contract = { ...result.contract, applied: false, error: e.message };
      log(`  contract FAILED: ${e.message}`);
    }
  }

  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/sap-fixup.test.mjs`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add tools/sam-devkit/lib/sap-fixup.mjs tools/sam-devkit/test/sap-fixup.test.mjs
git commit -m "feat(sam-devkit): setSapState orchestrator (status + auto-detected contract)"
```

---

### Task 5: `server.mjs` — wire the `sap-fixup` module

**Files:**
- Modify: `tools/sam-devkit/server.mjs`

**Interfaces:**
- Consumes: `loadDbConfig` (Task 3), `setSapState` (Task 4).
- Produces: HTTP behavior — `POST /run` with `{ module: 'sap-fixup', proposalId, sapStatus?, contractNo? }` streams per-step log lines then `RESULT <json>`; DB errors surface as `ERROR ...`. No login/token.

- [ ] **Step 1: Add imports**

At the top of `server.mjs`, extend the existing imports:

```js
import { loadConfig, loadDbConfig } from './lib/config.mjs';
import { setSapState } from './lib/sap-fixup.mjs';
```

(`loadConfig` is already imported — change that line to add `loadDbConfig`; add the `setSapState` line beside the other `lib/*` imports.)

- [ ] **Step 2: Add the module branch in `handleRun`**

Immediately after the module-presence check (the block that writes `'ERROR no module specified'` and returns), before `try { assertDevHost(apiBaseUrl); ... }`, insert:

```js
  if (module === 'sap-fixup') {
    try {
      const db = loadDbConfig(cfg);
      const r = await setSapState({
        db,
        proposalId: input.proposalId,
        sapStatus: input.sapStatus,
        contractNo: input.contractNo,
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

- [ ] **Step 3: Manual smoke check (no live DB needed for the wiring path)**

Run (from `tools/sam-devkit/`, with a `config.json` that has a `db` block pointing at a dev server):
`node server.mjs` then in another shell:
`curl -s -X POST localhost:8787/run -H "Content-Type: application/json" -d '{"module":"sap-fixup"}'`
Expected: an `ERROR` line naming invalid proposalId (`nope`/missing) — proves the branch is reached and validation runs. (A bad-GUID body like `{"module":"sap-fixup","proposalId":"x"}` should print `ERROR Error: Invalid proposalId (must be GUID): x`.)

Note: if you have no dev DB configured, a missing `db` block yields `ERROR ... missing "db" block` — also proves wiring.

- [ ] **Step 4: Run the full suite to confirm nothing regressed**

Run: `node --test`
Expected: PASS (all files).

- [ ] **Step 5: Commit**

```bash
git add tools/sam-devkit/server.mjs
git commit -m "feat(sam-devkit): expose sap-fixup module in server"
```

---

### Task 6: `index.html` — SAP fixup tab

**Files:**
- Modify: `tools/sam-devkit/index.html`

**Interfaces:**
- Consumes: server `sap-fixup` module (Task 5) via existing `stream()`.
- Produces: UI tab that posts `{ module:'sap-fixup', apiBaseUrl, proposalId, sapStatus?, contractNo? }`; omits `sapStatus` when "leave unchanged" (`__leave__`), sends `""` for clear; omits `contractNo` when blank.

- [ ] **Step 1: Add the nav button**

In the `<nav>` block, add after the Create button:

```html
  <button data-tab="sapfix">SAP fixup</button>
```

- [ ] **Step 2: Add the section**

After `<section id="tab-create" ...>...</section>`, add:

```html
<section id="tab-sapfix" hidden>
  <label>Proposal ID (guid)</label><input id="sf-proposalId">
  <label>SAP status</label>
  <select id="sf-status">
    <option value="__leave__">— leave unchanged —</option>
    <option value="success">success</option>
    <option value="fail">fail</option>
    <option value="">(clear)</option>
  </select>
  <label>Contract number (optional)</label><input id="sf-contractNo">
  <button id="sf-run">Run SAP fixup</button>
</section>
```

- [ ] **Step 3: Register the tab in `show()`**

Change the tab list in the `show` function from:

```js
    for (const s of ['approve', 'clone', 'create']) $('tab-' + s).hidden = (s !== tab);
```

to:

```js
    for (const s of ['approve', 'clone', 'create', 'sapfix']) $('tab-' + s).hidden = (s !== tab);
```

- [ ] **Step 4: Wire the run button**

At the end of the `<script>`, after the `$('cr-run').onclick = ...` block, add:

```js
  $('sf-run').onclick = () => {
    const status = $('sf-status').value;
    const body = { module: 'sap-fixup', apiBaseUrl: $('apiBaseUrl').value, proposalId: $('sf-proposalId').value };
    if (status !== '__leave__') body.sapStatus = status;
    const cn = $('sf-contractNo').value.trim();
    if (cn) body.contractNo = cn;
    stream(body);
  };
```

- [ ] **Step 5: Manual check**

Run `node server.mjs`, open `http://localhost:8787`, click **SAP fixup** → the section shows; other tabs hide. Enter a bad guid + Run → `ERROR ... Invalid proposalId` appears in the log pane.

- [ ] **Step 6: Commit**

```bash
git add tools/sam-devkit/index.html
git commit -m "feat(sam-devkit): SAP fixup UI tab"
```

---

### Task 7: config example + README

**Files:**
- Modify: `tools/sam-devkit/config.example.json`
- Modify: `tools/sam-devkit/README.md`

**Interfaces:** none (docs/config only).

- [ ] **Step 1: Add the `db` block to `config.example.json`**

Add a top-level `db` key (sibling of `roles`), so the file becomes:

```json
{
  "apiBaseUrl": "http://localhost:5000",
  "roles": {
    "srp": { "email": "srp@example.com", "password": "CHANGE_ME" },
    "sam": { "email": "sam@example.com", "password": "CHANGE_ME" },
    "sdm": { "email": "sdm@example.com", "password": "CHANGE_ME" },
    "pte": { "email": "pte@example.com", "password": "CHANGE_ME" },
    "cdr": { "email": "cdr@example.com", "password": "CHANGE_ME" }
  },
  "db": {
    "server": "localhost",
    "sam": { "database": "CHANGE_ME_SamDb", "user": "sa", "password": "CHANGE_ME" },
    "sap": { "database": "CHANGE_ME_SapDb", "user": "sa", "password": "CHANGE_ME" }
  }
}
```

- [ ] **Step 2: Document the module in `README.md`**

Add a section (after the existing "Notes" or before "Test"):

```markdown
## SAP fixup (direct DB — dev only)

Force-set a proposal's SAP state without the real SAP integration. Useful to make a
Type P approved proposal a valid clone source (`SAPStatus = success`), simulate `fail`,
or seed a contract number.

**Prerequisites**
- `sqlcmd` on PATH (SQL Server command-line tools).
- A `db` block in `config.json` (see `config.example.json`) pointing at your **dev** SQL Server.
  Two databases: `sam` (main — `Proposal.SAPStatus`) and `sap` (`CreateContract` / `ChangeContract`).

**What it writes**
- `SAPStatus` → main DB `Proposal.SAPStatus` (`success` / `fail` / clear).
- Contract number → SAP DB, table auto-detected from the proposal's type:
  - Type P → `CreateContract.SAP_CONTRACT_NO`
  - Type S → `ChangeContract.CONTRACT_NO`
  - Type R → no contract table (status is still updated).
- The contract UPDATE affects **all rows** for that `PROPOSAL_ID`; the tool reports rows affected.

**Notes**
- Values are written raw — SAP does not validate them. This is a dev fixup, not a real sync.
- The DB server must be a dev host (`localhost` / `.local` / etc.) or the tool refuses to run.
- Status and contract are independent writes across two DBs — partial success is possible and reported per step.
```

- [ ] **Step 3: Run the full suite (sanity — docs shouldn't break anything)**

Run: `node --test`
Expected: PASS (all files).

- [ ] **Step 4: Commit**

```bash
git add tools/sam-devkit/config.example.json tools/sam-devkit/README.md
git commit -m "docs(sam-devkit): document SAP fixup module + db config"
```

---

## Self-Review

**Spec coverage:**
- §2 direct-SQL/sqlcmd → Task 1. §3 grain + auto-detect + all-rows + R-skip → Task 4. §4.1 db.mjs → Task 1. §4.2 sap-fixup.mjs → Task 4. §4.3 assertDevDbServer → Task 2. §5 validation → Task 4 (tests + impl). §6 config → Task 3 + Task 7. §7 server → Task 5. §8 UI incl. `__leave__` sentinel mapping → Task 6. §9 tests → Tasks 1–4 test files. §10 README → Task 7. §11 risks (sqlcmd missing `-C`, ENOENT, two-DB partial) → Task 1 (ENOENT), Task 4 (partial), README (Task 7). All covered.

**Placeholder scan:** `CHANGE_ME*` appear only in example config (intended). No TBD/TODO in steps; every code step has full code.

**Type consistency:** `runSql({server,database,user,password,sql,exec})` used identically in Tasks 1, 4 (via `run`), and `db.mjs` default. `setSapState` signature identical in Task 4 interface, impl, and Task 5 call site. `loadDbConfig(cfg)` returns `{server,sam,sap}` consumed as `db.server`/`db.sam`/`db.sap` in Task 4 and Task 5. `CONTRACT_TABLE` keys 1/3 match P/S mapping. Consistent.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-01-sam-devkit-sap-fixup.md`.**

Order: Task 1 → 2 → 3 → 4 → 5 → 6 → 7 (5 depends on 3+4; 6 depends on 5). Full-suite gate (`node --test`) at Tasks 5 and 7.
