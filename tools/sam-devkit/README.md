# sam-devkit

Dev harness for the SAM proposal lifecycle. Two tools: **Approve-through** — drive a
Pending proposal through the full approval chain (`sam → sdm → pte → cdr`) without
logging in as four roles by hand — and **SAP fixup** — force-set a proposal's SAP
state directly in the DB. **Dev/local only — never point it at production.**

## Setup
```bash
cp config.example.json config.json   # edit with real dev creds + apiBaseUrl
node server.mjs                        # http://localhost:8787
```
Requires Node 18+. No `npm install` — zero dependencies.

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

## Test
```bash
node --test
```
