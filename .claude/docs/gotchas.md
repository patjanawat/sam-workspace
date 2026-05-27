# SAM Platform — Cross-Cutting Gotchas

Common patterns and traps that appear across multiple features. Read this before starting any task.

---

## Backend

### Architecture

**Vertical Slice — 2 files per operation**
Every feature operation = 1 Endpoint file + 1 Handler file. No service layer between them.
```
Features/Proposal/Create/
  CreateProposalEndpoint.cs    ← Carter ICarterModule: route, validation, auth policy
  CreateProposalHandler.cs     ← MediatR IRequestHandler: business logic + DB
```

**Carter auto-discovers `ICarterModule`** — no manual registration needed. Same for MediatR handlers.

**FluentValidation**: register validator in Endpoint, call `ep.UseFluentValidation()`. Handler gets pre-validated request.

**Mapster not AutoMapper**: use `request.Adapt<Entity>()` or `entity.Adapt<ResponseDto>()`. No `_mapper.Map<>()`.

---

### Database Access

**EF Core + Dapper — both used**
- EF Core: standard CRUD, transactions
- Dapper: complex queries, multi-result-sets, raw SQL performance
- ADO.NET directly: stored procs with OUTPUT parameters (Rebate feature)

**Dapper multi-result-set order must not change**
`SearchProposalsQueryHandler` uses `QueryMultiple` with 4 result sets. Changing SQL query order breaks deserialization silently.

**Two DbContexts**
- `SamAppDbContext` — SAM application data
- `SAPDbContext` — SAP staging tables (separate; injected separately)
Don't mix them.

---

### Optimistic Concurrency

**RowVersion = hex string** (not byte[])
- BE sends: `Convert.ToHexString(entity.RowVersion)`
- BE receives: `Convert.FromHexString(request.RowVersion)`
- FE must pass RowVersion back as-is — no transformation
- Affected: Proposal, CustomerGroup

**Approval optimistic lock gate uses status = 10**
Before approve/reject, raw SQL sets `ProposalStatus = 10` as in-progress sentinel (`SET LOCK_TIMEOUT 0`). Zero rows updated = already processed by another request.

---

### Async Jobs (Hangfire + SSE)

**CDR approval is ALWAYS async** — even single-item approve. Endpoint returns `jobId`, not result. Frontend must call `listenToJobEvents(jobId, ...)`.

**SSE endpoint pattern**: `GET /jobs/{jobId}/events` — `EventSource` on FE, auto-close on done/failed.

**Duplicate job guard**: check `ScopeKey` or `CloseMonth.JobIdProcessing` before enqueuing. Race handled via `SqlException 2601/2627` catch.

**`SapSyncServiceFallback`**: use in dev/test environments without SAP RFC connector DLL. Check DI registration in config.

---

### Business Logic Traps

**Proposal starts as Temp(0), not Draft(1)**
Flow: `POST /requests` → returns Temp → user fills general info → becomes Draft. FE should not assume proposal persists until Draft.

**Temp cleanup job runs**: Hangfire deletes Temp proposals. Don't reference a Temp proposal ID after a delay.

**CloseMonth blocks submit**: if period is closed, `POST /requests/{id}/submit` fails. Always check before trying to submit.

**Role-based SQL visibility** (not C# guards):
- `srp` sees only own proposals
- `sam` sees own + subordinates (via `ReportToId`)
- Higher roles see all
Logic is in SQL parameters `@RoleCode`/`@Step`, not in handler code.

**Bangkok timezone (UTC+7)** used for:
- CustomerGroup status (Active/Upcoming/Expire)
- UserDelegate status computation (midnight run)
- Proposal year/month validation (current/next month rule)

**ASM Auto-Bypass on Submit**: if submitter is ASM (sam), their own approval step is auto-approved immediately.

**SDM Auto-Delegate**: if SAM approves and ALL SDM users have active delegation today, SDM step is auto-approved (`IsDelegate = true` in history).

---

### User & Roles

**One role per user at all times** — enforced on Update: removes all current roles before adding new one.

**`RoleCode` is denormalized**: stored both in ASP.NET Identity `UserRoles` join table (source of truth) AND in `ApplicationUser.RoleCode` field.

**Do NOT set `UserDelegate.Status` manually** — owned by `UserDelegateStatusUpdateJob` (.NET BackgroundService). Runs at midnight UTC+7 + on app startup. Semaphore prevents double-execution.

**Manager options (`/users/options`)**: filtered to **active `sam` users only** — hardcoded in handler.

**Password history**: self-service password change (`PUT /users/update-password-by-user`) checks last 5 passwords. Admin reset does NOT check history.

---

### SAP Integration Traps

**SAP success indicators differ by flow**:
| Flow | Success |
|------|---------|
| Create Discount (Type R) | `"0"` |
| Create Contract (Type P) | `"C"` |
| Change Contract (Type S) | `"S"` |
Never assume same value across flows.

**`Features/Sync/` ≠ `Features/SapSync/`**:
- `Features/SapSync/` — sends Proposal data to SAP ERP
- `Features/Sync/SamSyncJob` (hourly) + `SamMonthlySyncJob` (days 1–5) — syncs **master data from data warehouse**. Unrelated to SAP ERP.

**Rebate month-end send-to-SAP ≠ Proposal sync**: `/report/send-to-sap` is close-month rebate data; gated by `CloseMonth`, uses different service and staging tables.

---

### Rebate Traps

**Agreement success = `returnValue == 0`; Accrued Sum success = `returnValue > 0`** — opposite logic. Don't assume one pattern applies to both.

**ADO.NET for stored procs**: `sp_sel_rebate_monthend` and `sp_sel_ar_dw` need `SqlCommand` with `SqlParameter(direction=Output)`. EF Core cannot handle OUTPUT params from stored procs.

**`ExportAccruedSum` filter**: `fiperiod > period` — exports data *after* the selected period. Intentional.

**SSE auth TODO**: `GET /rebates/calculate-agreement/jobs/{id}/events` has no auth middleware (TODO comment in code).

**ProposalRebate ≠ Month-End Rebate**: `RebatePayload`/`AccumPayload`/`SpecialPayload` on ProposalDetail are JSON strings set by Sale Rep — NOT related to the month-end rebate calculation.

---

### CustomerGroup Traps

**Type P: max 1 customer** — sending >1 throws `ApiValidationException` (400).

**CustomerGroup code is immutable after create** — EF `IsModified = false` on Code in Update handler.

**Code generation uses retry loop (max 5)** — race condition protection on unique constraint.

**CustomerGroup Update: dates only** — cannot change customers/products after create.

**`/customers/groups/available-option` vs `/customers/groups/option`**: available-option filters by period (for Proposal form); option is general dropdown.

---

## Frontend

### Hooks Pattern

**`genericHooks` — always use `{ body: data }` for mutations**:
```ts
// ✅ correct
mutate({ body: formData })

// ❌ wrong
mutate(formData)
```

**`useWatch` not `watch()`**:
```ts
// ✅ correct
const value = useWatch({ control, name: 'field' })

// ❌ wrong (stale, no re-render)
const value = watch('field')
```

**Dynamic Zod schemas**: User form schemas (`makeCreateUserSchema(roles)`) are factory functions — must rebuild when roles list changes.

**FE Zod schemas are independent from BE validators**: keep them in sync when BE validation changes.

---

### API & Auth

**All API calls go through `/gateway/proxy/*`** — never call backend directly from browser. Proxy injects `Authorization: Bearer <token>` from cookie.

**`isTemporaryPassword` cookie blocks everything** — middleware redirects to `/login`. User must change password before any access.

**Sliding token not implemented**: `X-Slided-Token` header from BE is ignored by FE. Token has fixed expiry from login time.

**SSE via `EventSource`**: `listenToJobEvents(jobId, onUpdate, onDone)` — auto-closes on done/failed. Use for CDR approval, batch sync, batch rebate jobs.

---

### Role-Based UI

**`sla` role only** can Create/Edit Customer Relations — checked on FE via `role === 'sla'`.

**Auditor (`adt`) can only export rebate** — cannot trigger calculations or close month.

**`assertRoleOr403`**: client-side role guard in approval feature — not a security control, just UX guard.

**Role permissions + default landing pages** in `src/shared/constants/permissions.ts` — update here when adding new roles or pages.

---

### Form Patterns

**`refetchOnMount: 'always'`**: `useGetGeneralInfo` always refetches on mount — ensures fresh data when navigating back to a form step.

**RowVersion must pass through**: if form fetches data with RowVersion, include it in update request payload unchanged.

**Overlap detection is real-time**: `RelationDetailForm` calls overlap API on every customer/date change. Don't debounce — existing behavior is intentional.
