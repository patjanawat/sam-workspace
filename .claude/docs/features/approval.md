# Feature: Approval

## Overview

The Approval feature manages the multi-step approval workflow for Proposals. An approver reviews a pending Proposal and can approve or reject it. The system tracks every decision in `ApprovalHistory` records and, when the final approver (Commercial Director) approves, it triggers downstream SAP sync jobs and writes data to `PROPOSAL_FOR_CALS` and `TARGETS` tables.

The feature splits into two parallel viewing tracks (SAM and SDM), shared mutation endpoints (approve/reject single and bulk), and a dedicated ApprovalSettings feature for configuring delegate relationships.

---

## Approval Flow (Step Sequence)

```
Proposal Pending (status=2)
  Step 0 — Area Sale Manager (sam)     → approve/reject
  Step 1 — Sale Division Manager (sdm) → approve/reject
  Step 2 — Pricing Team (pte)          → approve/reject
  Step 3 — Commercial Director (cdr)   → approve → status=3 (Approved) + SAP sync
                                        → reject  → status=4 (Rejected) at any step
```

Status codes (enum `RequestStatus`):

| Value | Name     |
|-------|----------|
| 1     | Draft    |
| 2     | Pending  |
| 3     | Approved |
| 4     | Rejected |
| 5     | Skipped  |

Tracking step (`ConvertRole.GetProposalTrackingStep`): derives the next waiting role from `ProposalStatus` + `LastApprovalRoleCode`. Used by the frontend stepper UI.

Auto-approve by SDM delegation: when a SAM approves and all SDM users are currently under active delegation, the system auto-inserts an `ApprovalHistory` record on behalf of the SDM (`IsDelegate = true`) before requiring PTE action.

---

## Two Parallel Tracks (SAM vs SDM)

Both tracks serve the same query shape (`GetApprovalsQuery`) and use the same underlying SQL (`SearchApprovalSql.Command` with Dapper multi-result-set). The difference is auth policy + data filtering via `@RoleCode` / `@Step` SQL parameters.

| | SAM Track | SDM Track |
|---|---|---|
| List endpoint | `POST /approval/search/sam` | `POST /approval/search/sdm` |
| Detail endpoint | `GET /approval/sam/{id}` | `GET /approval/sdm/{id}` |
| Auth policy | `SaleAreaManager` | `SaleDivisionAndAbove` |
| Extra detail check | Verifies proposal belongs to user or reportee | No ownership check |
| Extra list fields | — | `TotalDiscountRebate`, `PriceEXW` |
| Generic search | `POST /approval/search` | policy: `SaleAreaManagerAndAbove` |

---

## Key Backend Endpoints

| Method | Path | Operation | Auth Policy |
|--------|------|-----------|-------------|
| POST | `/approval/search/sam` | SAM list search (paged) | `SaleAreaManager` |
| GET | `/approval/sam/{id}` | SAM proposal detail | `SaleAreaManager` |
| POST | `/approval/search/sdm` | SDM list search (paged) | `SaleDivisionAndAbove` |
| GET | `/approval/sdm/{id}` | SDM proposal detail | `SaleDivisionAndAbove` |
| POST | `/approval/search` | Generic list search | `SaleAreaManagerAndAbove` |
| GET | `/approval/option` | Filter dropdowns | `[Authorize]` |
| PUT | `/requests/{id}/approve` | Approve single proposal | `ApproveRejectProposal` |
| PUT | `/requests/{id}/reject` | Reject single proposal | `ApproveRejectProposal` |
| PUT | `/approval/update` | Bulk approve/reject (synchronous) | `ApproveRejectProposal` |
| PUT | `/approval/list` | Batch approve selected list (Hangfire job) | `ApproveRejectProposal` |
| PUT | `/approval/all` | Approve all pending (Hangfire job) | `ApproveRejectProposal` |
| GET | `/approval-settings` | List delegate settings | `ApprovalSetting` |
| GET | `/approval-settings/search` | Search delegate settings | `ApprovalSetting` |
| PUT | `/approval-settings/{id}` | Update delegate setting | `ApprovalSetting` |
| GET | `/approval-settings/{id}` | Get single setting | `ApprovalSetting` |
| GET | `/approval-settings/option` | Setting form dropdowns | `ApprovalSetting` |
| GET | `/approval-settings/org-chart` | Org-chart view | `ApprovalSetting` |

---

## Single Approve/Reject

Handler: `UpdateApprovalHandler`

Uses a raw SQL `UPDATE Proposal SET ProposalStatus = 10 ... WHERE ProposalStatus = 2 AND RowVersion = ...` as an optimistic-lock gate. If 0 rows updated the proposal is already processed.

Commercial Director approval is offloaded to a Hangfire background job (`IUpdateApprovalJob`) — the endpoint returns immediately with a `jobId`. Progress is streamed via SSE at `GET /jobs/{jobId}/events`.

All other roles (SAM, SDM, PTE) execute synchronously within a transaction.

On success, `IApproveRejectEmailService.SendEmailApprovalNotification` fires (errors are swallowed).

When CDR approves: sets `ProposalStatus = 3`, executes `InsertProposalForCalSQL` and `InsertTargetSQL`, calls `ISapGenerateService` (Create/ChangeContract or CreateDiscount), then enqueues `ISapSyncService` Hangfire job.

`UpdateApprovalResponse.Status` values:

| Value | Meaning |
|-------|---------|
| `Success` | Done |
| `AlreadyApproved` | Proposal was already approved |
| `AlreadyRejected` | Proposal was already rejected |
| `Pending` | CDR job enqueued (async) |
| `Failed` | Exception |

---

## Bulk Operations

### `PUT /approval/update` — UpdateList (synchronous)
Handler: `UpdateApprovalListHandler`. Processes each item individually using the same lock-gate SQL. Returns per-item `succeeded`/`failed` count. No batch job.

### `PUT /approval/list` — ApproveList (Hangfire job)
Handler: `ApproveListHandler`. Only creates a `BatchJob` record for CDR role. Enqueues `IApproveListJob`. Returns `jobId` immediately.

### `PUT /approval/all` — ApproveAllPending (Hangfire job)
Handler: `ApproveAllPendingHandler`. Prevents duplicate jobs (checks running job by `ScopeKey`). Enqueues `IApproveAllPendingJob`. The job:
1. Calls search internally (pageSize=99999) to get all pending items
2. Calls `UpdateApprovalListRequest` via mediator to approve them all
3. Publishes SSE progress events at each stage (0% → 10% → 35% → 60% → 100%)

---

## Approval Settings

Feature: `ApprovalSettings` — manages delegation (SAM can delegate to SDM, SDM can delegate to PTE).

Entity: `UserDelegate` — one row per manager user.

DelegateStatus values: `1 = Normal`, `2 = Delegate`.

Manager roles shown in settings: `sam`, `sdm` only. Delegate target mapping: `sam → sdm`, `sdm → pte`.

Business rules enforced in `UpdateApprovalSettingHandler`:
- Delegate status requires `toId`, `delegatesFrom`, `delegatesTo` (all non-null)
- `delegatesFrom` must be <= `delegatesTo`
- `toId` must not equal self; target user must exist
- SAM/SDM users see only their own row; ADM/SLA see all

---

## Key Backend Files

| Path | Purpose |
|------|---------|
| `Features/Approval/Shared/ApprovalService.cs` | Core approve/reject — history, delegate auto-approve, CDR SAP trigger |
| `Features/Approval/Shared/ConvertRole.cs` | Maps role code to step label; derives next waiting step |
| `Features/Approval/Shared/ApproveRejectEmailService.cs` | Email notification after approve/reject |
| `Features/Approval/Update/UpdateApprovalHandler.cs` | Single approve/reject — optimistic lock + CDR async job dispatch |
| `Features/Approval/UpdateList/UpdateApprovalListHandler.cs` | Bulk approve/reject list (synchronous per-item) |
| `Features/Approval/ApproveAllPending/ApproveAllPendingJob.cs` | Hangfire job: fetch pending → bulk approve + SSE progress |
| `Features/Approval/ApproveList/ApproveListHandler.cs` | Hangfire job dispatch for selected-list approval |
| `Features/Approval/Sam/Search/GetApprovalSamQueryHandler.cs` | Dapper multi-RS query for SAM list |
| `Features/Approval/Sdm/Search/GetApprovalSdmQueryHandler.cs` | Dapper multi-RS query for SDM list (extra fields) |
| `Features/Approval/Sam/GetById/GetApprovalByIdHandler.cs` | SAM detail — enforces reportee ownership check |
| `Features/Approval/Sdm/GetById/GetApprovalByIdHandler.cs` | SDM detail — no ownership check |
| `Features/Approval/Search/SearchApprovalSql.cs` | Shared Dapper SQL (multi-RS): summaries, paged list, customers |
| `Features/ApprovalHistories/ApprovalProgressQuery/ApprovalProgressQueryHandler.cs` | 4-step progress tracker with CanApprove/CanReject |
| `Features/ApprovalSettings/GetAll/GetApprovalSettingsQueryHandler.cs` | Delegate settings list with status grouping |
| `Features/ApprovalSettings/Update/UpdateApprovalSettingHandler.cs` | Upsert UserDelegate with business rule validation |

---

## Key Frontend Files

| Path | Purpose |
|------|---------|
| `features/approval/hooks/index.ts` | All TanStack Query hooks + SSE listener |
| `features/approval/types/approval-list-update.ts` | Bulk decision types, JobStatus, JobResponse |
| `features/approval/types/approval.types.ts` | FormValues, ApprovalItem, ApprovalFilters |
| `features/approval/types/approval-search.ts` | `ApprovalSearchRequest` |
| `features/approval/types/approval-progress-query-response.ts` | Progress stepper response shape |
| `features/approval/constants/approval-roles.ts` | `RolesApproval` array (4 roles), `ViewerRole` type |
| `features/approval/mapper/approval-progress.mapper.ts` | Progress data mapper |
| `features/approval/utils/assertRoleOr403.utils.ts` | Client-side role guard |
| `features/approval/components/lists/` | List page: filter bar, approve/reject/approve-all buttons, table |
| `features/approval/components/details/` | Detail page: stepper, tabs per type R/S/P |
| `features/approval/shared/` | ApprovalHeader, ApprovalPageAction, status/type badges |

---

## Key Frontend Hooks

| Hook | Purpose |
|------|---------|
| `useGetApprovalById(id, role)` | Fetch detail — selects `/sam/{id}` or `/sdm/{id}` by role |
| `useApprovalSearch(body)` | POST search with `keepPreviousData` (30s staleTime) |
| `useGetApprovalQuery()` | Mutable POST search hook |
| `useUpdateApprovals()` | PUT `/approval/update` — synchronous bulk approve/reject |
| `useApproveList()` | PUT `/approval/list` — Hangfire job for selected items |
| `useApproveAllPending()` | PUT `/approval/all` — Hangfire job for all pending |
| `listenToJobEvents(jobId, onUpdate, onDone)` | Opens `EventSource` to `/jobs/{jobId}/events`; auto-closes on done/failed |
| `useGetJobActiveByTypeQuery(params)` | Poll `/jobs/active` to check if a batch job is already running |
| `useGetApprovalOptionQuery()` | GET `/approval/option` filter dropdowns |

---

## Business Rules & Gotchas

1. **CDR approval is always async**: single (`/requests/{id}/approve`) and bulk (`/approval/list`, `/approval/all`) go through Hangfire jobs when actor is CDR. Frontend must call `listenToJobEvents` to track completion.

2. **Optimistic lock gate**: before any approve/reject, raw SQL sets `ProposalStatus = 10` as an in-progress sentinel (`SET LOCK_TIMEOUT 0` — fails fast on contention). Zero rows = already processed.

3. **Track separation is auth, not data**: SAM and SDM tracks use the same SQL query. The SQL uses `@RoleCode` and `@Step` parameters to filter what each role sees.

4. **SDM auto-delegate**: if SAM approves and all SDM users have active delegation today, an auto-approve history is inserted for SDM (`IsDelegate = true`), skipping the SDM manual step.

5. **Bulk approve-all is CDR-only**: `ApproveAllPendingHandler` only creates a `BatchJob` record when `currentUser.RoleCode == CommercialDirector`.

6. **Duplicate job guard**: `ApproveAllPendingHandler` checks for existing `Queued/Running` batch job by `ScopeKey`. Handles race via `SqlException 2601/2627` catch.

7. **Email errors are swallowed**: `SendEmailApprovalNotification` wraps in `try/catch` — broken email config does not fail the approval.

8. **RowVersion is hex string**: clients receive `RowVersion` via `Convert.ToHexString`. Must pass back as-is; backend decodes with `Convert.FromHexString`.

9. **SAM GetById enforces ownership**: checks `proposal.SaleId == currentUser.UserId` OR the sale user has `ReportToId == currentUser.UserId`. Violations throw `ApiForbiddenException`. SDM handler has no such check.

10. **Progress always returns 4 slots**: `ApprovalProgressQueryHandler` pads the `progress[]` array to exactly 4 elements regardless of completion state.

---

## Related Features

- **Proposal** (`Features/Proposal/`) — created here, submitted (status → Pending) to enter approval queue
- **ApprovalHistories** (`Features/ApprovalHistories/`) — `ApprovalProgressQuery` endpoint consumed by detail handlers
- **SapSync** (`Features/SapSync/`) — `ISapSyncService` and `ISapGenerateService` called on CDR final approval
- **User / UserDelegate** — delegation records read by `ApprovalService` and `ApprovalSettings`
- **Jobs** — `BatchJob` entity, `IProgressBus`, SSE `/jobs/{jobId}/events` for bulk approval progress
- **CloseMonth** — closed month may block proposal edits upstream before approval
