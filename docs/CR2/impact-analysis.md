# CR#2 Clone Proposal Type P (cross-month within year) — Impact Analysis (FE/BE)

**Sources:**
- Spec: `docs/CR2-project-proposal-management.md` (generic version, broader scope)
- Meeting: `docs/CR5-review-meeting-summary.md` ข้อ 2 (narrowed scope)
- Codebase: SAM submodule (`web/web/backend/`, `web/web/frontend/`)

**Change summary:** Clone source dropdown — expand from `prev+current month only` → `all months within current year` filtered by `ProposalGroup.CODE LIKE 'P%'` (Type P only).

## Meeting Delta vs CR2 Spec

| Item | Spec (CR2.md) | Meeting (narrowed) |
|---|---|---|
| Scope | All proposal types | **Type P only** (S/P รายเดือนเดิม) |
| Range UI | From/To month-year pickers | **No pickers** — auto = current year |
| Year boundary | unbounded | **ห้ามข้ามปี** (ค.ศ./พ.ศ.) |
| Terminate concept | Q1 open | **Resolved:** Terminate = clone + shorten `value_to` = Modify flow, no new status |
| Form fields | New form | **Same form** — edit `value_to` + `volume` (เดิม) |
| Modify deferred | Yes | Modify = clone + edit (already supported) |

→ Scope **smaller** than spec. Single handler tweak + minor FE filter.

## Backend Impact

### Clone Source endpoint

| File | Change | Severity |
|---|---|---|
| `Features/Proposal/GetRequestNumberOptions/GetRequestNumberProposalOptionQueryHandler.cs:21-30` | Replace 2-line month bound `[minMonthYearInt..currentMonthYearInt]` with: **year filter only** when `ProposalGroup.CODE LIKE 'P%'` (use `request.SaleOrg + ProposalGroupId` already filtered). Keep `prev+current month` rule for Type R/S. | **H** |
| `Features/Proposal/GetRequestNumberOptions/GetRequestNumberOptionsQuery.cs:3-12` | No change (`ProposalGroupId` already in query — handler resolves Type) | — |
| `Features/Proposal/GetRequestNumberOptions/GetRequestNumberOptionsQueryValidator.cs:3-19` | No change | — |
| `Features/Proposal/GetRequestNumberOptions/GetRequestNumberProposalOptionEndpoint.cs:3-15` | Keep `[Authorize]` (or apply `CreateProposal` policy per CR2 spec — optional hardening) | L |

### Handler logic (pseudo)

```csharp
var pg = await db.ProposalGroups.AsNoTracking()
    .FirstOrDefaultAsync(x => x.ID == request.ProposalGroupId, ct);
bool isTypeP = pg?.CODE.StartsWith("P") ?? false;

var thYear = DateTime.Today.Year;  // หรือใช้ TH timezone helper
var monthYearMin = isTypeP ? thYear * 100 + 1   : minMonthYearInt;
var monthYearMax = isTypeP ? thYear * 100 + 12  : currentMonthYearInt;

var requestsBase = db.Proposals.AsNoTracking()
    .Where(r => r.SaleOrgCode == request.SaleOrg
        && r.ProposalGroupId == request.ProposalGroupId
        && r.CustomerGroupId == request.CustomerGroupId
        && (r.Year * 100 + r.Month) >= monthYearMin
        && (r.Year * 100 + r.Month) <= monthYearMax);
```

### Filters preserved

| Filter | File | Status |
|---|---|---|
| `WhereApprovedByCommercialDirector()` | `Features/Proposal/Shared/Queries/ProposalQueries.cs:56-60` | Unchanged — Terminated proposal still = `Approved` status (no new status) |
| `WhereCustomerGroupNotExpire()` | `ProposalQueries.cs:43-54` | Unchanged |
| SAP success rule `(ProposalGroupId != 1 \|\| SAPStatus == "success")` | Handler line 35 | Unchanged |
| `ProposalStatus` enum | `Features/Proposal/Shared/Enums/ProposalEnums.cs:22` | **No new value** — meeting confirmed Terminate ≠ separate status |

### Type P entity

| File | Status |
|---|---|
| `Entities/ProposalProductTypeP.cs:15-16` | `FROM_DATE`, `TO_DATE` (DateOnly) — Modify flow already updates `TO_DATE` |
| `Features/ProposalDetails/CreateCommand/CreateProposalProductTypeP.cs:30-31,47-48` | Clone path uses `ValidFrom`/`ValidTo` — already covers shorten case |
| `Shared/JSON/Models/TypePPayload.cs:7-13` | Payload supports `ValidFrom`/`ValidTo` |

### Helper (unused, leave)

| File | Status |
|---|---|
| `Features/Proposal/Shared/Queries/ProposalQueries.cs:8-28` `WhereInPrevCurrNextMonthTh()` | Still unused — skip |

### Tests

| File | Change |
|---|---|
| `SamApp.WebApi.Tests/Features/Proposal/GetRequestNumberOptions/...` | New xUnit cases: Type P returns full year, Type R/S returns prev+current only, year boundary 31 Dec → 1 Jan no cross |

**BE file count:** 1 handler + tests

## Frontend Impact

### Hook + Form

| File | Change | Severity |
|---|---|---|
| `features/request/hooks/index.ts:126-160` `useGetRequestNoOptions` | **No change** — backend handles type-aware filter (transparent to FE) | L |
| `features/request/components/list/details/ProposalForm.tsx:7,91-95` | Clone tab — verify dropdown renders larger list for Type P. Add search filter if not present (UX guard). | M |

### Types / Schema

| File | Change |
|---|---|
| `features/request/types/request.types.ts:103-120` (`RequestNoResponse`, `VersionData`) | No change |
| `features/request/types/request.types.ts:167` `ProposalType = 'R' \| 'S' \| 'P'` | No change |
| `shared/enums/proposal.enum.ts:1-16` (`ProposalCreateMode`, `ProposalStatus`) | **No new status** (meeting confirmed) |
| `features/request/schema/request.schema.ts:8-75` | No change |

### Display / UX

- Type P clone form already opens **only `ValidTo` + `Volume`** for edit (per meeting Art confirm) — no field change
- Dropdown may grow ~12× (year vs 2 months) — add client-side search/typeahead if absent

**FE file count:** 1 component verify (no logic change)

## Risk / Blocker

| Item | Severity | Note |
|---|---|---|
| Year boundary edge case | **Med** | 31 Dec proposal — next day = new ค.ศ. → dropdown empty? UX: ปลายปีให้ user create from blank (no clone source) |
| Buddhist vs Christian year mismatch | Med | `r.Year` in DB = AD or BE? Verify before deploy |
| Dropdown growth | Low | Up to ~12 months × N proposals. Add search/sort by recency |
| Type R/S regression | **High** | Handler shared — accidentally widen R/S to full year. Mitigate: explicit `if (isTypeP)` branch + unit test for R/S |
| Terminated proposal as source | Low | Already `Approved` — included by existing filter. Just verify e2e |
| Customer group expired during year | Low | `WhereCustomerGroupNotExpire` still excludes — by design |
| Clone old → recalc pricing/discount? | **Med** | Q4 in spec still open — Type P pricing/period may be stale 6+ months → confirm with BA whether revalidate against current master |

## Effort vs CR2 Spec

Spec: BE 2.25d + FE 2.75d + review/QA/UAT = 7.5d total.

Meeting narrows scope:
- BE — **0.5d** (single handler `if` branch, no DTO/validator change) → save ~1.75d
- FE — **0.5d** (no picker UI, just verify dropdown + add search) → save ~2.25d
- Tests — **1d** (Type P + Type R regression cases)
- Review/QA/UAT — **1.5d**

**Revised total ~3.5d** (down from 7.5d)

## Action Items

1. Confirm `r.Year` storage = AD (Christian year) — meeting said "พ.ศ./ค.ศ. ห้ามข้ามปี" (both)
2. Confirm year boundary handling (31 Dec edge): empty dropdown = acceptable?
3. Confirm Type S/P pricing/discount **revalidation** on clone (Q4 open in CR2 spec)
4. Add unit test guard: Type R/S handler behavior unchanged
5. UI: add dropdown search if missing — protects against year-worth row growth
6. Decide: tighten endpoint policy to `CreateProposal` (srp+sam) per CR2 spec, or defer
