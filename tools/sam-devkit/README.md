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

## Test
```bash
node --test
```
