# sam-devkit — SAP fixup module (design)

**Date:** 2026-07-01
**Status:** Approved (design), pending implementation plan
**Scope:** `tools/sam-devkit/` only. Out of scope of SAM-1763 (dev tooling, not product code). Does **not** touch `web/`.

---

## 1. Goal

Add a dev-only tool to sam-devkit that force-sets a proposal's **SAP status** and **contract number** to arbitrary values via **direct SQL**, bypassing the real SAP integration. Purpose: general SAP-state fixup for dev/test scenarios (e.g. making a Type P approved proposal `SAPStatus = success` so it becomes a valid clone source, simulating fail states, seeding contract numbers).

**Constraints**
- Dev/local only — never production.
- Preserve sam-devkit's **zero runtime dependency** principle (no npm installs).
- No changes to `web/` backend or frontend.

---

## 2. Background — why direct SQL

The SAM backend exposes **no API endpoint** to set SAP status or contract number:

- `Proposal.SAPStatus` is written only by the internal `SapSyncService` (real SAP call) — `web/web/backend/SamApp.WebApi/Shared/SAP/SapSyncService.cs:90`, or by the resend command handler `web/.../Features/SapSync/Command/ResendSapSyncList/ResendSapSyncListCommandHandler.cs:173`.
- Contract number (`SAP_CONTRACT_NO` / `CONTRACT_NO`) is written only by `SapSyncService` from the real SAP return.
- SAP-sync endpoints are only `GET /sap-sync/list`, `GET /sap-sync/{id}`, `POST /sap-sync/resend/{id}`, `POST /sap-sync/resend/list` (`web/.../Features/SapSync/SapSyncEndpoint.cs`). `resend/{id}` requires an already-**failed + approved** proposal AND a reachable live SAP; it cannot force arbitrary status/contract.

Therefore the only way to force arbitrary SAP state in dev is a direct DB write. Chosen mechanism: **`sqlcmd` via `child_process`** — keeps zero-dep (vs adding a `mssql`/`tedious` npm package) and avoids modifying `web/` (vs a new dev endpoint).

---

## 3. Data model / grain

Two databases (two connection strings in the backend — `Program.cs:85` `Database`, `Program.cs:95` `SAPDb`):

| Field | DB (backend conn) | Table.Column | Key | Values |
|---|---|---|---|---|
| SAP status | main (`Database`) | `Proposal.SAPStatus` (nvarchar) | `Id` (GUID) | `success` / `fail` / `""` (clear) |
| Contract no — Type P | SAP (`SAPDb`) | `CreateContract.SAP_CONTRACT_NO` (nvarchar(50)) | `PROPOSAL_ID` | string ≤ 50 |
| Contract no — Type S | SAP (`SAPDb`) | `ChangeContract.CONTRACT_NO` (nvarchar(50)) | `PROPOSAL_ID` | string ≤ 50 |

Anchors: `Proposal.SAPStatus` → `web/.../Entities/Proposal.cs:42`; SAP tables → `web/.../Database/SAPDbContext.cs:13-69`.

**Contract table auto-detection:** the tool has only a `proposalId`. It first runs `SELECT ProposalGroupId FROM Proposal WHERE Id = @id` (main DB), then maps:

- `ProposalGroupId = 1` (P) → update `CreateContract.SAP_CONTRACT_NO`
- `ProposalGroupId = 3` (S) → update `ChangeContract.CONTRACT_NO`
- `ProposalGroupId = 2` (R) → **no contract table** → skip the contract write, log a warning ("Type R has no SAP contract table — status updated only").

A proposal can have **multiple contract rows** per `PROPOSAL_ID` (unique index is on `PROPOSAL_ID, SOLDTO, MATERIAL_CODE, PAGE`). The contract UPDATE hits **all rows** for that `PROPOSAL_ID`; the tool reports `@@ROWCOUNT`.

---

## 4. Components

### 4.1 `lib/db.mjs` (new) — sqlcmd runner
- Export `runSql({ server, database, user, password, sql })` → returns trimmed stdout; throws on nonzero exit code with stderr text.
- Spawns: `sqlcmd -S <server> -d <database> -U <user> -P <password> -C -b -h -1 -W -Q "<sql>"`
  - `-C` trust server cert (sqlcmd 18+), `-b` exit nonzero on SQL error, `-h -1` no headers, `-W` trim whitespace.
- Uses `node:child_process` `spawn` (or `execFile`); args passed as an array (no shell interpolation) so the connection args can't be shell-injected.
- Accepts an injectable runner (default real `spawn`) so tests can stub it.

### 4.2 `lib/sap-fixup.mjs` (new) — orchestrator
`setSapState({ db, proposalId, sapStatus, contractNo, run = runSql, log = () => {} })`:
1. **Validate** inputs (see §5). Throw on invalid.
2. If `sapStatus` provided (incl. explicit clear): `UPDATE Proposal SET SAPStatus = '<val>' WHERE Id = '<guid>'` on `db.sam`. Log rows affected.
3. If `contractNo` provided:
   a. `SELECT ProposalGroupId FROM Proposal WHERE Id = '<guid>'` on `db.sam`.
   b. Map to table (§3). R → skip + warn.
   c. `UPDATE <table> SET <col> = '<contractNo>' WHERE PROPOSAL_ID = '<guid>'` on `db.sap`. Log rows affected.
4. Return `{ status: {applied, rows}, contract: {applied, table, rows, skippedReason} }`. Steps are **independent** — a failure in step 2 vs 3 is reported per-step (partial success possible).

At least one of `sapStatus` / `contractNo` must be provided, else throw "nothing to update".

### 4.3 `lib/guard.mjs` (extend)
Add `assertDevDbServer(server)` mirroring `assertDevHost`: allow only `localhost`, `127.0.0.1`, `::1`, `*.local`, and bare hostnames resolving to those; reject anything that looks like a remote/prod host. Throw a clear dev-only refusal otherwise.

---

## 5. Input validation (SQL-injection defense)

All values are validated **before** building SQL; anything failing is rejected with a clear error. Validated values are additionally single-quote-escaped (`'` → `''`) as defense-in-depth.

- `proposalId`: must match GUID regex `^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$`.
- `sapStatus`: must be one of `success`, `fail`, `""` (empty = clear). Anything else rejected.
- `contractNo`: must match `^[A-Za-z0-9_\-\/]{0,50}$` (≤ 50 chars, alnum + `_ - /`). Empty string allowed only if the intent is explicit "clear contract" — otherwise treat empty as "not provided".

---

## 6. Config

`config.json` / `config.example.json` gain an **optional** `db` block, validated only when the `sap-fixup` module runs (existing API-only flows stay working with no `db` block):

```json
"db": {
  "server": "localhost",
  "sam": { "database": "<samdb>", "user": "sa", "password": "CHANGE_ME" },
  "sap": { "database": "<sapdb>", "user": "sa", "password": "CHANGE_ME" }
}
```

`lib/config.mjs`: add a separate `loadDbConfig(raw)` that validates `db.server`, `db.sam.{database,user,password}`, `db.sap.{database,user,password}`. `loadConfig` (roles + apiBaseUrl) is unchanged and does **not** require `db`. `/config` endpoint continues to never expose passwords (may expose `db.server` for display only — optional).

---

## 7. server.mjs

Add module `sap-fixup` to `handleRun`:
- No login (direct DB, no token).
- Load `db` config via `loadDbConfig`; if missing → `ERROR sap-fixup requires a "db" block in config.json`.
- `assertDevDbServer(db.server)`.
- Call `setSapState({ db, proposalId, sapStatus, contractNo, log })`; stream per-step log lines; write final `RESULT <json>`.

---

## 8. index.html

New nav tab **SAP fixup**, section `tab-sapfix`:
- Proposal ID (guid) — `sf-proposalId`
- SAP status — `sf-status` select with options: **leave unchanged** (sentinel value `__leave__`), `success`, `fail`, **clear** (empty string `""`).
- Contract number (optional) — `sf-contractNo`.
- Run button — client builds the POST body and **omits `sapStatus` entirely when the select is `__leave__`**; sends `sapStatus: ""` for the clear option, otherwise the literal value. Contract number is omitted when the field is blank. Posts `{ module: 'sap-fixup', proposalId, sapStatus?, contractNo? }` via existing `stream()`.

So `__leave__` is a UI-only sentinel that never reaches the server; the server/`setSapState` only ever see `sapStatus` as `success` / `fail` / `""` / absent (§5).

Add `'sapfix'` to the `show()` tab list.

---

## 9. Tests (`node --test`, fake fetch/spawn — no live DB)

- `test/sap-fixup.test.mjs`:
  - status-only update builds correct `UPDATE Proposal … WHERE Id` and runs on `sam` db.
  - contract update auto-detects table: P → CreateContract/SAP_CONTRACT_NO, S → ChangeContract/CONTRACT_NO.
  - R-type → contract skipped with reason, status still applied.
  - both fields → two runs, correct DBs.
  - validation rejects bad guid / bad status / bad contractNo / nothing-to-update.
  - partial success: status runs, contract runner throws → result reports status applied + contract error.
- `test/db.test.mjs`: `runSql` builds correct arg array (no shell string); nonzero exit throws with stderr; injectable runner.
- extend `test/config.test.mjs`: `loadDbConfig` accepts valid block, rejects missing server/db/user/password; `loadConfig` still passes without a `db` block.

---

## 10. README

Add a "SAP fixup" section: what it does, prereqs (**`sqlcmd` on PATH**, `db` creds in `config.json`), that it writes **two DBs**, R-type has no contract table, dev-only warning, and that it bypasses real SAP (values are not validated by SAP).

---

## 11. Risks / notes

- `sqlcmd` must be installed and on PATH; if absent, the spawn fails → surface a clear "sqlcmd not found" error.
- sqlcmd 18+ requires `-C` (trust cert) against a dev SQL Server with a self-signed cert — included.
- Two DBs = two independent writes → partial success is possible and is reported per-step.
- Type R proposals have no SAP contract table → status-only.
- The tool writes raw values with no SAP-side validation — a nonsense contract number is accepted; that's intended for dev fixup.

---

## 12. Effort

~0.5 day: `lib/db.mjs` + `lib/sap-fixup.mjs` + guard extension + config extension + server module + UI tab + 3 test files + README. No `web/` changes.
