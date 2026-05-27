# CR#8 Remove Pricing Team from Approval Flow — Impact Analysis (FE/BE)

**Sources:**
- Meeting: `docs/CR5-review-meeting-summary.md` ข้อ 8
- Codebase: SAM submodule (`web/web/backend/`, `web/web/frontend/`)

**Change summary:** ตัด **Pricing Team (pte)** ออกจาก approval flow. Flow ใหม่: `srp → sam → sdm → cdr` (เดิม 4 ขั้น → 3 ขั้น). SAP sync pricing check **ยังคงเดิม**. Manao keep PTE code (no delete) — รองรับ rollback.

→ Related: **CR9 delegate change** (sdm delegate → cdr direct, not pte). Couple deploy with CR9.

## Strategy

| Option | Note |
|---|---|
| **A) Delete pte from flow code** | Simpler, smaller diff. Re-add hard if rollback |
| **B) Feature flag `feat.approvalFlow.skipPte`** | Toggle on/off without redeploy. Meeting said "เก็บเวอร์ชั่นเก่าไว้" → **Recommend B** |

→ Use **single config value** (e.g. `Flow.UseLegacy = bool`) wrapping flow array + delegate targets + email recipients + step calc. Default = new flow (no pte). Toggle off = legacy 4-step.

## Backend Impact

### Core flow array

| File | Change | Severity |
|---|---|---|
| `Features/ApprovalHistories/ApprovalProgressQuery/ApprovalProgressQueryHandler.cs:10` | Replace hard-coded `Flow = [sam(0), sdm(1), pte(2), cdr(3)]` → `[sam(0), sdm(1), cdr(2)]` (or config-driven) | **H** |

### Search / list step calc + visibility

| File | Change |
|---|---|
| `Features/Approval/Search/SearchApprovalSql.cs:191-192` | Change `WHEN ap.RoleCode = 'sdm' THEN 'PT'` → `'CD'`. Remove `WHEN ap.RoleCode = 'pte' THEN 'CD'` |
| `Features/Approval/Search/SearchApprovalSql.cs:271-280` | Remove `pte` visibility branch (sees sdm/pte/cdr) |
| `Features/Approval/Search/SearchApprovalSql.cs:285` | CDR visibility: change from `cdr sees pte/cdr` → `cdr sees sdm/cdr` |

### Delegation config (couples with CR9)

| File | Change |
|---|---|
| `Features/ApprovalSettings/GetAll/GetApprovalSettingsQueryHandler.cs:12` `DelegateTargetsByRole` | Change `sdm → pte` → `sdm → cdr` (per CR9) |
| `Features/ApprovalSettings/GetOptions/GetApprovalOptionHandler.cs:9` `DelegateRoleCodes` | Remove `pte` (only sdm delegates now) — confirm with CR9 |

### Auto-approve on SDM delegate

| File | Change |
|---|---|
| `Features/Approval/Shared/ApprovalService.cs:266` `AutoApproveBySdmAsync` | Search target = `pte` → change to `cdr` OR remove if delegate flow change makes obsolete |

### Email notification

| File | Change |
|---|---|
| `Shared/Helpers/ApproveRejectEmailService.cs:54,157-167` | Remove `pteHistory` lookup + `pte` notification object |
| `Shared/Helpers/NotificationEmailHelper.cs:27,47-56,157-192` | Remove `pte` from `NotifyAsync` params, `GetSenderName` switch, `ResolveRecipientsAsync` flow `sam→sdm→pte→cdr` → `sam→sdm→cdr` |

### Role helpers (keep code, but adjust permission)

| File | Change |
|---|---|
| `Shared/Helpers/UserRoleHelper.cs:16` `GlobalRolesViewAllProposal` | Keep `pte` (read-only access still possible) OR remove (confirm with Art) |
| `Shared/Helpers/UserRoleHelper.cs:33` `CanApprovalListAction` | Remove `PricingTeam` (cannot approve anymore) |

### Org chart

| File | Change |
|---|---|
| `Features/ApprovalSettings/GetOrgChart/GetApprovalOrgChartHandler.cs:10` | Remove `pte` from org chart roles |

### Role enum / constants (KEEP — meeting requested rollback safety)

| File | Status |
|---|---|
| `Shared/Enums/UserRole.cs:9,24,37` `UserRole.Pte` + name + code | **Keep** — for rollback |
| `Shared/Constants/UserRoleConstants.cs:9` `PricingTeam = "pte"` | **Keep** |
| `Database/Seed/SeedRole.cs:17` | **Keep** — pte role still exists in DB |
| Existing pte user accounts | **Keep active** — just no approval flow assignment |

### SAP sync (verify NO change)

| File | Action |
|---|---|
| `Features/SapSync/...` / `Features/Sync/...` | **Verify** Pricing check stays. Search "pte" in SAP sync flow — should be unchanged per meeting |

### Tests

| File | Change |
|---|---|
| `SamApp.WebApi.Tests/Features/Approval/...` | Update flow tests: 3-step expected |
| New test | Pte user → 403 / cannot approve |
| New test | sdm approve → next = cdr (not pte) |
| New test | Email recipients no longer include pte |
| Regression | SAP sync pricing logic unchanged |

**BE file count:** ~10 files + tests

## Frontend Impact

### Stepper (visible chain)

| File | Change | Severity |
|---|---|---|
| `features/approval/components/details/DetailStepper.tsx:21` | 4-step `[sam, sdm, pte, cdr]` → 3-step `[sam, sdm, cdr]` | **H** |

### Role constants

| File | Change |
|---|---|
| `features/approval/constants/approval-roles.ts:6` `RolesApproval` | Remove `"Pricing Team"` |
| `features/approval/constants/approval-roles.ts:10` `ViewerRole` type | Decide: keep `'pte'` (view-only) or remove. Meeting: keep for rollback → **keep type, remove from active list** |

### Approval routes per role (keep page, deactivate nav)

| File | Action |
|---|---|
| `app/(protected)/approval/.../pricing-team/` route (if exists) | **Hide** from navigation, keep code for rollback |
| Role-based nav menu | Filter out `pte` link |

### Approval status display ("Pending With Who" — relates CR10)

| File | Change |
|---|---|
| Any component showing `pte` as current step | Replace logic — sdm approved → next = cdr |

### Markups (storybook)

| File | Change |
|---|---|
| Approval markups using pte mock data | Update fixtures to skip pte |

**FE file count:** ~4-5 files

## Coupled changes (related CRs)

| CR | Coupling |
|---|---|
| **CR9** | Delegate sdm → cdr (directly) — must deploy together |
| **CR10** | "Pending With Who" column — must reflect new flow |
| **CR5 mass upload** | Approver: sdm → cdr (skip sam for mass) — already matches new flow |

## Constraints (per meeting)

| Rule | Enforcement |
|---|---|
| SAP pricing check unchanged | BE SAP sync verify — no code touch |
| Keep PTE code for rollback | Don't delete enum/const/seed/handlers — only remove from flow array |
| Apply all proposal types (R/S/P) | Single flow shared — change once |

## Risk / Blocker

| Item | Severity | Note |
|---|---|---|
| Coupling with CR9 (delegate) | **H** | Must deploy same release — partial deploy breaks delegate UX |
| In-flight pte-pending proposals | **High** | Existing pending proposals stuck at pte step. **Migration:** auto-advance to cdr OR manual triage |
| pte users' existing access | Med | Keep view permission? Decide with Art |
| Rollback path | Med | If toggle removed → hard rollback = revert PRs. Recommend feature flag |
| Email template breaks | Med | Removed pte recipient → template variables may reference null — guard |
| FE stepper width / layout | Low | 4→3 steps may change visual spacing |
| Notifications historical replay | Low | Old emails reference pte — fine, no rewrite |

## Migration / Data

| Item | Action |
|---|---|
| Pending proposals at pte step | Run SQL — auto-advance to cdr OR queue for manual SDM re-approve |
| ApprovalHistory historical pte rows | **Keep** — audit trail intact |
| pte users — UserDelegate active records | Audit + cleanup before cutover |

## Effort Estimate

| Phase | Effort |
|---|---|
| BE flow array + feature flag wrapper | 0.5 d |
| BE search SQL update (step + visibility) | 0.5 d |
| BE delegate config + auto-approve | 0.5 d |
| BE email notification flow | 0.5 d |
| BE role helpers + org chart | 0.3 d |
| BE tests + regression | 1.5 d |
| BE migration SQL — pending proposals at pte | 0.5 d |
| FE stepper + role constants | 0.3 d |
| FE nav filter + markups | 0.5 d |
| FE tests | 0.5 d |
| Coordination with CR9 delegate | 0.3 d |
| Code review + QA + UAT | 2.0 d |
| **Total** | **~7.9 d** |

## Action Items

1. **Block:** Confirm with Art — keep pte view access or remove fully?
2. Decide feature flag vs hard removal
3. **Block:** Coordinate with CR9 — same PR/release window
4. Audit in-flight pte-pending proposals — migration plan
5. Audit existing UserDelegate to pte — cleanup
6. SAP sync verify — no pte removal in pricing check
7. Email template variable guard — handle missing pte
8. Update org chart UI
