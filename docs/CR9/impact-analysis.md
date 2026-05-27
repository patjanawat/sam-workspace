# CR#9 Delegate after Pricing Team removed — Impact Analysis (FE/BE)

**Related docs:** [solutions.md](solutions.md) · [flows.md](flows.md) · [code-changes.md](code-changes.md)

**Sources:**
- Meeting: [../CR5/review-meeting-summary.md](../CR5/review-meeting-summary.md) ข้อ 9
- Codebase: SAM submodule (`web/web/backend/`, `web/web/frontend/`)
- Couples with: **CR8 (Pricing Team removal)** — same release window — see [../CR8/](../CR8/)

**Change summary:** Sale Division Manager (sdm) delegate target = **CDR** (เดิม pte). PTE ออกจาก delegator list + target list. CDR delegate function = **deactivate** (keep code).

→ Meeting note: "delegate ใช้น้อยมาก ไม่เคยใช้" — low usage, low blast radius.

## Backend Impact

### Target role mapping

| File | Change | Severity |
|---|---|---|
| `Features/ApprovalSettings/GetAll/GetApprovalSettingsQueryHandler.cs:9-12` `DelegateTargetsByRole` | Change `SDM → PTE` → `SDM → CDR`. Keep `SAM → SDM` unchanged | **H** |
| `Features/ApprovalSettings/GetOptions/GetApprovalOptionHandler.cs:9` `DelegateRoleCodes` | Remove `PTE` from delegator list. SDM remains. **CDR not added** (CDR cannot delegate per meeting "deactivate"). Keep `cdr` code commented or guarded for rollback | **H** |

### Auto-approve via delegate

| File | Change |
|---|---|
| `Features/Approval/Shared/ApprovalService.cs:58,237,262-267` `AutoApproveBySdmAsync` + `IsAllSdmDelegatedAsync` | Update PTE auto-approve target → CDR. If SDM delegates all → auto-approve flows to CDR (not pte) |
| `Shared/Helpers/ApproveRejectEmailService.cs:196` `GetDelegatedTo` | No code change — already generic lookup |

### Delegate CRUD (no change)

| File | Status |
|---|---|
| `Features/ApprovalSettings/GetAll/GetApprovalSettingsEndpoints.cs` | Unchanged |
| `Features/ApprovalSettings/GetById/GetApprovalSettingByIdEndpoint.cs` | Unchanged |
| `Features/ApprovalSettings/Update/UpdateApprovalSettingsEndpoint.cs` | Unchanged — validator pulls from updated mapping |
| `Features/ApprovalSettings/GetOptions/GetApprovalOptionEndpoint.cs` | Unchanged |

### Entity / Migration

| File | Status |
|---|---|
| `Entities/UserDelegate.cs:3` | No schema change |
| `Database/SamAppDbContext.cs:197,337` | Unchanged |
| `Migrations/20251016102126_Initial.cs:556` `SkipAndDelegate` | Unchanged |

### Status update job

| File | Status |
|---|---|
| `Features/User/UserDelegateStatusUpdateJob.cs:3` + `UserDelegateStatusUpdateService.cs:21` | Unchanged — role-agnostic |

### Validator (add guard)

| File | Change |
|---|---|
| `Features/ApprovalSettings/Update/.../Validator` (if exists) | Validate `TargetRole ∈ DelegateTargetsByRole[FromRole]` — reject if user submits SDM→PTE post-cutover |

### Tests

| File | Change |
|---|---|
| `SamApp.WebApi.Tests/Features/ApprovalSettings/...` | Update target mapping tests: SDM→CDR expected |
| New test | SDM delegate → CDR auto-approve flow |
| New test | PTE delegator creation → 400 (no longer allowed) |
| Regression | SAM → SDM delegate unchanged |

**BE file count:** ~3 files (mapping + service) + tests

## Frontend Impact

### Delegate form / dialog

| File | Change | Severity |
|---|---|---|
| `features/settings/approval/components/details/DelegateForm.tsx:29,52,55-58` `filteredManagers` | Change filter: `SDM → PTE` → `SDM → CDR`. Remove PTE-as-delegator branch | **H** |
| `features/settings/approval/components/details/DelegateDialog.tsx:39` | Verify props pass through correctly | L |
| `features/settings/approval/components/EditDelegateButton.tsx:13` | Verify role visibility — pte should not see edit button | L |

### Types / Hooks

| File | Change |
|---|---|
| `features/settings/approval/types/approval-settings.types.ts:1,76` `ApprovalSettingFormIn` + `DelegateManagerDto` | No type change — values change only |
| `features/settings/approval/hooks/index.ts:37,61` `useGetApprovalSettingsOptionQuery` + `useUpdateApprovalSetting` | Pass-through — backend drives options |
| `shared/utils/delegate-options.ts:3` `DelegateStatus` | Unchanged |

### Settings page

| File | Status |
|---|---|
| `app/(protected)/settings/approval/page.tsx:1` | No route change |

### Markups / fixtures

| File | Change |
|---|---|
| Delegate-related storybook fixtures | Update mock: SDM→CDR |

**FE file count:** 1-2 files (DelegateForm + verify)

## CDR "Deactivate" decision (per meeting)

| Item | Current State | Decision |
|---|---|---|
| CDR delegate function — outgoing | Not in `DelegateRoleCodes` (already excluded) | **No-op** — already deactivated by design |
| Keep CDR delegate code for rollback | N/A — never enabled | Document in comment: "CDR delegate intentionally excluded — see CR9" |

→ Meeting confusion suggests Art expected CDR-as-delegator existed. Verify with Art current behavior matches assumption.

## Migration / Data

| Item | Action |
|---|---|
| Existing UserDelegate rows: SDM → PTE | **Migration SQL** — convert active records to SDM → CDR OR cancel & notify users to re-create |
| Existing UserDelegate rows: PTE → * | Cancel (PTE no longer delegator) |
| In-flight proposals with PTE delegate path | CR8 migration covers this |

## Risk / Blocker

| Item | Severity | Note |
|---|---|---|
| Coupling with CR8 | **H** | Must deploy together — partial = delegate UI shows pte but flow skips |
| Data migration UserDelegate active rows | **H** | SDM→PTE active records → invalid post-cutover. Auto-convert SQL OR notify users |
| CDR current delegate state unknown | Med | Verify CDR not currently in delegator list — Art assumption may be wrong |
| User UX confusion | Med | "delegate ใช้น้อยมาก" — low impact, but communicate to sdm users |
| Validator strict mode breaks legacy callers | Low | Only 1 hook in FE (`useUpdateApprovalSetting`) — verify no external API consumers |
| Email template delegate variables | Low | Pre-existing — verify CDR recipient renders |

## Effort Estimate

| Phase | Effort |
|---|---|
| BE target mapping change | 0.3 d |
| BE AutoApproveBySdmAsync update | 0.3 d |
| BE validator add | 0.3 d |
| BE migration SQL (UserDelegate active rows) | 0.3 d |
| BE tests | 0.7 d |
| FE DelegateForm filter | 0.3 d |
| FE markup + visual verify | 0.3 d |
| FE tests | 0.3 d |
| Coordination with CR8 | shared with CR8 |
| Code review + QA + UAT | 0.7 d |
| **Total** | **~3.5 d** (bundled with CR8) |

## Action Items

1. **Block:** Bundle with CR8 — same PR + release
2. Confirm current CDR delegate state with Art (assumption vs reality)
3. Plan UserDelegate active row migration (SDM→PTE → SDM→CDR or cancel)
4. Add validator guard — reject invalid target post-cutover
5. Document CDR-deactivate decision in code comment
6. Notify sdm users via release notes (delegate now to CDR, not PTE)
7. Update markups + storybook fixtures
