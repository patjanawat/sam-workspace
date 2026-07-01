# sam-devkit

Dev harness for the SAM proposal lifecycle. Create / clone a proposal and drive it
through the full approval chain (`sam → sdm → pte → cdr`) without logging in as
four roles by hand. **Dev/local only — never point it at production.**

## Setup
```bash
cp config.example.json config.json   # edit with real dev creds + apiBaseUrl
node server.mjs                        # http://localhost:8787
```
Requires Node 18+. No `npm install` — zero dependencies.

## Prerequisites (dev env)
- Role accounts for `srp, sam, sdm, pte, cdr` that log in.
- **Approval chain (full):** either submit as `srp` with `srp.ReportToId = sam`, OR submit as `sam`
  (ASM step auto-bypasses → chain starts at `sdm`). Without the report-to link, the sam-track
  detail GET returns 403 — see the spec's Module C prerequisite.
- Each Create/Clone form has a **Submit as** selector: `srp` (full 4-step chain — requires `srp.ReportToId = sam`) or `sam` (auto-bypasses the ASM step so the chain starts at `sdm`).
- **Clone:** an **Approved** source proposal (Type P source also needs `SAPStatus = success`).
- **Create:** at least one valid `productId` from `GET /rebates/options` for your chosen
  (customer group, sales org, type). Use the raw-payload field if the template can't express it.

## Notes
- Login uses lockout — a wrong password locks the account after N tries. The tool fails fast on the
  first 401; fix `config.json` before re-running.
- `proposalGroupId` mapping is **P=1, R=2, S=3**.
- CDR approval is async (Hangfire) — the tool reports the `jobId`; SAP sync completes in the background.
- ⚠️ Not yet exercised against a live SAM API — the test suite is unit-only (fake fetch). The first real run is effectively the integration test; verify create/clone/approve against your dev backend before relying on it.

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
  To allow a LAN dev SQL Server (e.g. `192.168.2.10,31433`), add its host to `db.allowedServers`
  in `config.json` (e.g. `"allowedServers": ["192.168.2.10"]`). Any server not localhost-ish
  and not explicitly listed is still refused, so production stays protected.
- Status and contract are independent writes across two DBs — partial success is possible and reported per step.

## Test
```bash
node --test
```
