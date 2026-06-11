# SAM — Shared Context

Source of truth for stack, architecture, key paths, and DB rules. Any agent prompt that conflicts with this file should defer to it.

---

## Stack

### Backend — `web/web/backend/SamApp.WebApi/`

- **Framework**: .NET 10, C# — FastEndpoints + Carter (`ICarterModule`)
- **CQRS**: MediatR — `IRequest` / `IRequestHandler`
- **ORM**: Entity Framework Core 10 + Dapper (both used — see DB Access below)
- **Database**: SQL Server
- **Auth**: JWT Bearer + ASP.NET Identity
- **Jobs**: Hangfire (SQL Server)
- **Storage**: MinIO
- **Logging**: Serilog
- **Mapping**: Mapster (not AutoMapper)
- **Validation**: FluentValidation

### Frontend — `web/web/frontend/src/`

- **Framework**: Next.js 15 (App Router), TypeScript strict
- **UI**: Radix UI + Tailwind CSS v4
- **State**: Zustand + TanStack Query v5
- **Form**: React Hook Form + Zod v4
- **Table**: TanStack Table
- **Mock**: MSW v2
- **Toast**: Sonner
- **Dates**: Dayjs (never `new Date()` for formatting)

---

## Business Domain

**SAM** (Sales Activity Management) — Proposal-based pricing approval system.

### Core Flow

```
Sale Rep สร้าง Proposal → Submit → Approval chain (SAM → SDM → CDR) → Approved → Sync to SAP
```

### Key Concepts

| Term | Meaning |
|---|---|
| **Proposal** | Price/promo approval request. Status: Draft → Pending → Approved / Rejected |
| **ProposalGroup** | Proposal type (Type R, S, P) — determines products and pricing structure |
| **Approval** | Multi-step approval process per role hierarchy |
| **ApprovalHistory** | Log of each approve/reject action, including delegate and bypass |
| **Rebate** | Month-end rebate calculation from sales volume |
| **CustomerGroup** | Customer group tied to a Proposal |
| **SAP Sync** | Send approved Proposal data to SAP ERP |
| **UserDelegate** | Temporary approval delegation to another user |
| **CloseMonth** | Month-end lock — prevents editing proposals for the closed period |

### Roles & Approval Hierarchy

| Code | Role | Responsibility |
|---|---|---|
| `srp` | Sale Representative | Creates Proposals |
| `sam` | Area Sale Manager | Approves at Area level |
| `sdm` | Sale Division Manager | Approves at Division level |
| `cdr` | Commercial Director | Final approval |
| `pte` | Pricing Team | Price validation |
| `fin` | Finance | Financial validation |
| `adt` | Auditor | Audit review |
| `sla` | Sale Admin | Master data management |
| `adm` | System Admin | System administration |

### Proposal Status

```
Draft (1) → Pending (2) → Approved (3)
                       → Rejected (4)
                       → Skipped (5)
```

> Proposals start as **Temp (0)** before becoming Draft. Temp proposals are auto-deleted by Hangfire if not completed.

---

## Backend Architecture — Vertical Slice

Every feature operation = 2 files per use case:

```
Features/
  {Feature}/
    {UseCase}/
      {UseCase}Endpoint.cs      ← Carter route + FluentValidation validator
      {UseCase}CommandHandler.cs ← MediatR handler + contracts
```

- Carter auto-discovers `ICarterModule` — no manual registration
- MediatR handlers auto-discovered — no manual registration
- Use `Mapster` for object mapping: `entity.Adapt<ResponseDto>()`
- Use `primary constructor` syntax for DI (C# 12+)

---

## Request Flow

```
HTTP Request
  → Next.js App Router (pages)
    → /api/gateway/proxy/*  (Next.js proxy — injects Bearer token from cookie)
      → .NET Backend (Carter/FastEndpoints)
        → FluentValidation (pre-validated)
          → MediatR handler
            → EF Core / Dapper
              → SQL Server
```

**All API calls from browser go through `/api/gateway/proxy/*`** — never call BE directly from FE.

---

## Key Paths

### Backend (`web/web/backend/SamApp.WebApi/`)

| Path | Purpose |
|---|---|
| `Features/` | Feature modules (Vertical Slice) |
| `Features/Proposal/` | Proposal management |
| `Features/Approval/` | Approval workflow |
| `Features/Customers/` | Customer management |
| `Features/Rebates/` | Rebate management |
| `Features/SapSync/` | SAP integration |
| `Features/Sync/` | Master data sync from data warehouse (NOT SAP ERP) |
| `Features/User/` | User management |
| `Features/Role/` | Role & permissions |
| `Entities/` | EF Core entity models |
| `Migrations/` | EF Core database migrations |
| `Infrastructure/` | DI setup, middleware, shared services |

### Frontend (`web/web/frontend/src/`)

| Path | Purpose |
|---|---|
| `app/(protected)/` | Authenticated page routes (Server Components) |
| `features/` | Feature modules |
| `features/request/` | Proposal/request pages |
| `features/approval/` | Approval pages |
| `features/customers/` | Customer pages |
| `features/rebate/` | Rebate pages |
| `features/sap-sync/` | SAP sync pages |
| `components/ui/` | shadcn-style Radix UI primitives |
| `lib/genericHooks.ts` | `useGet`, `useList`, `usePost`, `usePatch`, `useDelete` |
| `lib/server-errors-context.tsx` | BE validation errors → form field errors |
| `lib/invalidate.relations.ts` | Related endpoint cache invalidation registry |
| `lib/api.ts` | Core fetch wrapper |
| `shared/constants/permissions.ts` | Role permissions + default landing pages |

---

## DB Access Rules

**Two DbContexts — never mix:**
- `SamAppDbContext` — SAM application data
- `SAPDbContext` — SAP staging tables (separate DI injection)

**EF Core + Dapper — both used:**
- EF Core: standard CRUD, transactions
- Dapper: complex multi-result queries, raw SQL performance
- ADO.NET directly: stored procs with OUTPUT parameters (Rebate feature only)

**Dapper multi-result-set order must not change** — `SearchProposalsQueryHandler` uses `QueryMultiple` with 4 result sets; changing SQL order breaks deserialization silently.

**Optimistic concurrency:**
- `RowVersion` stored as hex string (not byte[])
- BE sends: `Convert.ToHexString(entity.RowVersion)`
- BE receives: `Convert.FromHexString(request.RowVersion)`
- FE must pass RowVersion back unchanged

---

## Async Jobs (Hangfire + SSE)

**CDR approval is ALWAYS async** — endpoint returns `jobId`, not result. FE must call `listenToJobEvents(jobId, ...)`.

**SSE pattern**: `GET /jobs/{jobId}/events` — `EventSource` on FE, auto-close on done/failed.

**Duplicate job guard**: check `ScopeKey` before enqueuing — race handled via `SqlException 2601/2627` catch.

---

## Auth & Session

**JWT Bearer + cookie**: token stored in cookie, FE proxy injects `Authorization: Bearer` header.

**`isTemporaryPassword` cookie**: blocks ALL access — middleware redirects to `/login`. User must change password first.

**Role-based SQL visibility** (not C# guards):
- `srp` — own proposals only
- `sam` — own + subordinates (via `ReportToId`)
- Higher roles — all proposals
Logic is SQL `@RoleCode`/`@Step` params, not handler code.

---

## Bangkok Timezone (UTC+7)

Used for:
- CustomerGroup status (Active/Upcoming/Expire)
- UserDelegate status computation (midnight run)
- Proposal year/month validation

---

## Task Workflow (plan.md / progress.md)

SAM tickets have a scratchpad at `tasks/<TICKET>/` inside the workspace (see `sam-paths.md` § Task Scratchpads) with:

- `plan.md` — evolving plan & summary for the ticket
- `progress.md` — phased checklist + `## Log` of state changes

### When parent agent provides a ticket ID (e.g. `SAM-123`)

**Before writing code:**
1. Read `tasks/<TICKET>/plan.md` if it exists — honors agreed approach, prior decisions, out-of-scope notes. Flag conflicts back to parent instead of diverging silently.
2. Read `tasks/<TICKET>/progress.md` `## Log` to understand what's done and pending.

**After writing code (before returning to parent):**
3. Append ONE line to `## Log` in `tasks/<TICKET>/progress.md`:
   ```
   - <YYYY-MM-DD>: <agent-name> — <short summary> — files: <comma-separated paths> — verify: <result>
   ```
4. Flip `[ ]` → `[x]` for completed phase checkboxes in `progress.md`.
5. Do NOT edit `plan.md` unless parent explicitly asks.
6. If `tasks/<TICKET>/` does not exist — just do the work and mention the missing folder in reply.

### Log Entry Format

```
- <YYYY-MM-DD>: <agent-name> — <short summary (10–20 words)> — files: <path1>, <path2> — verify: <result>
```

- `<agent-name>`: ba-expert, orchestrator, dotnet-developer, frontend-developer, tester, code-reviewer, expert-viewer
- `verify`: tsc clean / N tests pass / no security issues / not run

Rule: append only — never overwrite prior Log entries.

### When no ticket ID is provided

Skip the workflow entirely — just do the work.
