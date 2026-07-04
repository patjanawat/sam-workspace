# sam-devkit

Dev harness for the SAM proposal lifecycle. Four tools: **Approve-through** — drive a
Pending proposal through the full approval chain (`sam → sdm → pte → cdr`) without
logging in as four roles by hand — **SAP fixup** — force-set a proposal's SAP
state directly in the DB — **Clone → Draft** — copy a proposal (details included)
into a fresh Draft directly in the DB — and **Inspector** — read-only X-ray of one
proposal for investigation. **Dev/local only — never point it at production.**

## Setup
```bash
cp config.example.json config.json   # edit with real dev creds + apiBaseUrl
node server.mjs                        # http://localhost:8787
```
Requires Node 18+. No `npm install` — zero dependencies.

## Build a standalone executable (no Node needed to run)

For teammates who can't install Node, package a single-file executable via Node SEA:

```bash
npm run build          # → dist/sam-devkit(.exe)
```

Requires **Node 20+** to build (uses `node:sea`); `esbuild` + `postject` are fetched via `npx`
(build-time only — the runtime stays zero-dependency). `index.html` is embedded into the binary;
`config.json` is read from **beside the executable** at runtime.

Ship `dist/sam-devkit(.exe)` together with a filled-in `config.json` next to it, then run it and
open http://localhost:8787.

> **Per-OS:** the build copies *this machine's* Node binary, so it is **not** cross-platform — run
> `npm run build` **on each target OS**: Windows → `sam-devkit.exe`, macOS/Linux → `sam-devkit`.
> A Windows `.exe` will **not** run on macOS/Linux and vice-versa. On macOS you may also need to
> re-sign the output: `codesign --remove-signature dist/sam-devkit` before postject (the build) and
> `codesign --sign - dist/sam-devkit` after, then clear quarantine with `xattr -d com.apple.quarantine`.

## Environments

`config.json` can hold multiple named environment profiles instead of one flat config:

```json
{
  "defaultEnv": "local",
  "environments": {
    "local":   { "apiBaseUrl": "http://localhost:5000", "roles": { ... }, "db": { ... } },
    "develop": { "apiBaseUrl": "https://web-sam-dev.manaosoftware.com/api", "roles": { ... } },
    "qa":      { "apiBaseUrl": "https://web-sam-qa.manaosoftware.com/api", "roles": { ... } }
  }
}
```

The UI shows an **Environment** dropdown (populated from `GET /config`) so you can switch
between `local` / `develop` / `qa` without editing `config.json` — the API base URL field just
displays the selected env's URL and is read-only. Each env has its own `roles` (and optional
`db` block for SAP fixup); nothing is shared across envs.

Configuring an environment is itself the opt-in: each profile's `apiBaseUrl` host is
automatically added to that profile's `allowedHosts`, so the dev-host guard passes for any
env you've deliberately set up — you don't need a separate `allowedHosts` entry just to use it.
Hosts not covered by an env profile (or its explicit `allowedHosts`) are still refused.

**Backward compatible:** a flat config — `{ apiBaseUrl, roles, db, allowedHosts }` with no
`environments` key — still works exactly as before, as an implicit single `"default"` environment.

## Prerequisites (dev env)
- Role accounts for `srp, sam, sdm, pte, cdr` that log in.
- **Approve-through:** the `sam` account must be allowed to see the proposal — it must own the
  proposal or be the creator's manager (`ReportToId`), otherwise the sam-track detail GET returns
  403. (If the proposal was submitted by an ASM, that step is already auto-approved and the chain
  effectively starts at `sdm`.)

## Notes
- Login uses lockout — a wrong password locks the account after N tries. The tool fails fast on the
  first 401; fix `config.json` before re-running.
- `proposalGroupId` mapping is **P=1, R=2, S=3** (used by SAP fixup to pick the contract table).
- CDR approval is async (Hangfire) — the tool reports the `jobId`; SAP sync completes in the background.
- ⚠️ Not yet fully exercised against a live SAM API — the test suite is unit-only (fake fetch).
  Verify approve-through / SAP fixup against your dev backend before relying on it.

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
- Contract number → also written into main DB `ProposalDetail.RebatePayload` JSON
  (`values.contract[colId].new` for every product, across all non-deleted pages; the page payload
  is double-encoded, so the tool parses → updates → re-stringifies each page). Reported as `payload`.
- **🎲 Random (11 digits)** button fills the contract field with a random 11-digit number.

**Notes**
- Values are written raw — SAP does not validate them. This is a dev fixup, not a real sync.
- The DB server must be a dev host (`localhost` / `.local` / etc.) or the tool refuses to run.
  To allow a LAN dev SQL Server (e.g. `192.168.2.10,31433`), add its host to `db.allowedServers`
  in `config.json` (e.g. `"allowedServers": ["192.168.2.10"]`). Any server not localhost-ish
  and not explicitly listed is still refused, so production stays protected.
- Status and contract are independent writes across two DBs — partial success is possible and reported per step.

## Clone → Draft (direct DB — dev only)

Copy an existing proposal into a new **Draft** — including all detail rows — without
walking the FE create wizard. Search a `RequestNo`, pick the source, pick a mode, run.

**Modes**

| Mode | RequestNo | Version | Year/Month | Types |
|---|---|---|---|---|
| **New version** | same as source | auto `MAX(Version)+1` | current month | P, R, S |
| **New proposal** | new — typed, or empty = auto-generate with the real BE format `{org}-{saleOffice}-{type}{yy}{running:5}` | 0 | current month **+ 1** | R, S only (Type P is locked to New version) |

The month follows the mode on purpose: the real backend keeps the same `RequestNo` only for
same-month clones and issues a new `RequestNo` across months, so devkit clones look exactly
like organically created ones.

**What it copies** (single SQL transaction, `sqlcmd`): the `Proposal` row plus
`ProposalDetail` (rebate/special/accum payloads), `ProposalCustomer`, `ProposalProduct`,
`ProposalProductTypeP` / `ProposalProductTypeRS`, and `ProposalFile` (rows only — files keep
pointing at the same MinIO objects). Column lists are discovered from `sys.columns` at run
time, so schema drift and `RowVersion` are handled automatically. `ApprovalHistory` is **not**
copied.

**Overrides on the new row:** new `Id`, `ProposalStatus = 1` (Draft), `PreviousId = source.Id`
(P.M. Max baseline keeps working), `RequestDateUTC`/`CreatedDateUTC = now`, `SAPStatus` reset.

**Notes**
- Source should be **Approved** (Type P also `SAPStatus = success`) to mirror the real clone
  rule — devkit only **warns** and clones anyway, so you can clone Drafts while testing.
- `RequestNo + Version` uniqueness is checked before insert.
- The DB guard is the same as SAP fixup (`localhost` / `db.allowedServers` only).
- Direct DB insert skips the CustomerGroup-availability check (1 Draft/Pending per group per
  period) — acceptable for a dev tool, but the FE may show overlapping drafts.
- The new proposal id lands in the **recent list**, so you can immediately run Approve-through on it.
- Each search row has an **Action** column — copy the proposal id, or open the proposal in the web app.
- After a successful clone the search box switches to the result's `RequestNo` and the list
  **auto-refreshes**, so the fresh Draft shows up immediately (both modes).

## Inspector (direct DB — read-only)

X-ray one proposal to answer "where is it stuck and why" without opening SSMS.
Paste a proposal id (or pick one from the recent list) and run — everything is
`SELECT`-only through the same `db` config + dev-host guard as SAP fixup.

**What it shows**
- **Header** — status decoded (incl. the `10` in-progress sentinel), Type P=1/R=2/S=3,
  period, CustomerGroup, creator (+role), dates, `SAPStatus`, `RowVersion` (hex).
- **Version lineage** — walks the `PreviousId` chain both directions; current node flagged.
- **Approval timeline** — `ApprovalHistory` in order, with `BYPASS` (ASM auto-bypass) and
  `DELEGATE` badges.
- **Who can approve right now** — derives the waiting role from history + status, lists that
  role's users and why each can/can't act: lockout, inactive, active delegation today
  (Thai timezone), sam-track ownership (creator or their direct manager only — otherwise
  the detail GET 403s), and the SDM auto-delegate rule (ALL SDM delegating → step
  auto-approves).
- **Diagnosis** — always-on checklist: stuck sentinel 10, Temp(0) cleanup, CloseMonth lock
  for the period, Approved-but-`SAPStatus`-empty (async CDR job), CustomerGroup conflict
  (another Draft/Pending on the same CG this period), past-month clone rule.
- **Payloads** — decodes the double-encoded rebate/special/accum JSON: schemaVersion,
  active/deleted pages, product ids, contract values.
- **Related rows** — ProposalCustomer / ProposalProduct / ProposalFile (MinIO keys).

**Notes**
- Requires the `db` block in `config.json` (same as SAP fixup); no role accounts needed.
- Writes nothing. To fix what it finds, use SAP fixup / Clone / SQL by hand.

## Overview X-ray (direct DB — read-only)

Recomputes the **Approval › Overview** table (the per-product discount/rebate
"รายละเอียด / Details" grid at `/approval/{id}`) from raw DB rows, and shows for
every column: **source → grain/filter → formula → the actual arithmetic** for
the clicked row. Column sets follow the real screen: **SAM** = short set with
the rebate breakdown; **SDM · PTE · CDR** = long set (+Price EXW, UCM,
Var-Cost, Comm. Margin, % vs Price List). Type R / S / P grains are all
implemented, mirrored from `Features/Approval/{Sam,Sdm}/GetById/OverviewDetailType{R,S,P}.cs`.

**Verify mode** — devkit logs in with the `sam` / `sdm` account from
`config.json`, calls the real `GET /approval/sam|sdm/{id}`, and diffs its own
numbers against the API cell by cell. Mismatched cells turn red with both
values. This doubles as a drift detector: the BE formulas exist twice
(`Sam/` vs `Sdm/`) and devkit is a third copy — when any of them drifts, the
diff lights up.

**Known BE quirks it surfaces** (verified from code, 2026-07-04)
- Type R excludes `SR2/AR1` from the rebate sum; Type S includes them.
- "Net Freight" column is really `SUBSIDY` (freight subsidy snapshot at save-time).
- `PRICE_LIST`/`SUBSIDY`/`VAR_COST` come from `g.First()` without an ORDER BY.
- Type P with-previous path never selects `VAR_COST` → Var-Cost shows 0 and
  Comm. Margin is computed with 0 whenever the proposal has a previous version.
- Type P PM matches the previous proposal's row by the **same page number** —
  gapped pages miss and show 0.

**P.M. Max screen** — the X-ray tile's third screen compares the
`meta.pmLastStep` baseline STORED in the saved rebate payload against what the
BE would inject today (`InjectPmMaxBaseline`: same reindexed page → its
baseline; added page or missing counterpart → page-1 fallback). A `STALE` cell
means the persisted baseline drifted from the recomputed one — the SAM-1810
family of bugs, caught per (page, section, product).

**Summary screen** — the X-ray tile's second screen replicates the **Request ›
Summary footer** (Current / Latest Approved / Changed) plus a per-section
breakdown showing exactly which section contributes what. It computes the two
grains independently, the classic confusion point:
- *Current* = FE `accumulateMaxBySection` — per section, max(`new`) on that
  section's last countable page (added pages included).
- *Latest Approved* = BE baseline recomputed devkit-side from the previous
  proposal's `ProposalProductTypeRS`: max(RATE) per (PAGE, product, RATE_TYPE)
  → reindex gapped pages → last-page-per-section collapse (+ Discount as
  `discountHeader`). Constant — editing the draft never moves it.
- No `PreviousId` → Latest falls back to max(`old`) per section, added pages
  excluded (SAM-1767 rule). The report labels which baseline path was used.

## People & Permissions (direct DB — read-only + one opt-in write)

Type an email (exact or partial) or part of a name → one card answers the
recurring "ปุ่มหาย / มองไม่เห็น / login ไม่ได้" class of tickets:

- **Org** — manager chain up (`ReportToId`, recursive), direct reports down
  (+indirect count), sale office/group.
- **Delegates today** (Thai timezone) — anyone on the chain actively delegating
  shows a `delegating → X (from → to)` badge; delegations *received* by the user
  are listed too.
- **Lockout** — locked accounts show `LOCKED until …` with an **unlock** button —
  the module's only write (`LockoutEnd = NULL, AccessFailedCount = 0`), behind a
  confirm dialog. Dev accounts lock constantly (lockout-on-failure policy).
- **Permission matrix** — which FE menus the role can reach
  (`ROLE_PERMISSIONS` + landing page) and which BE policies pass
  (`Program.cs AddPolicy` → role list, ✓/✕ per policy).

The matrix reads `lib/permissions-snapshot.json`, generated from the real
sources (`permissions.ts` + `Program.cs`) and stamped with the source commit.
When `web/` permission code changes, regenerate:

```bash
npm run gen-permissions
```

## SAP Sync Inspector (direct DB — read-only)

Compares main DB `Proposal.SAPStatus` against the SAP staging table for the
proposal's period, decoding the flow-specific success indicator so you don't
have to remember it: **Create Discount (Type R) → `"0"`**, **Create Contract
(Type P) → `"C"`**, **Change Contract (Type S) → `"S"`** — never the same
value twice. Read-only companion to **SAP fixup**, which writes.

**What it flags**
- `main=success` but no staging row for the period → sync never landed, or
  wrong period.
- `main=success` but staging `SAP_RETURN` doesn't decode to that flow's
  success value → main/staging disagree.
- Synced successfully (Type P/S) but no contract number written to staging.
- `main` empty with an existing staging row → possibly stuck mid-update.
- `main=fail` matching a failed staging row is reported **ok** — that's the
  expected state, not a mismatch.

Staging rows list `DOCNO`, raw `SAP_RETURN`, decoded success, contract number,
`SAP_MESSAGE`, and `PROCESSED_AT`.

## Test
```bash
node --test
```
