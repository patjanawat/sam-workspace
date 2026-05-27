# AI Agent Documentation Hybrid Setup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ตั้งค่า AI agent documentation structure แบบ hybrid ภายใน `web/` codebase — รวม branch-style hierarchy เข้ากับ workspace-quality code patterns เพื่อให้ agent ได้ context ที่ถูกต้องและครบถ้วน

**Architecture:** AGENTS.md อยู่ใน codebase (version-controlled กับ code), hierarchical loading (root → backend/frontend → selective docs/), code patterns มี ✅/❌ examples ป้องกัน antipatterns. `.claude/agents/` workspace ลดเป็น thin wrappers สำหรับ orchestration-level agents เท่านั้น

**Tech Stack:** Markdown docs only — ไม่มี code changes. Git submodule (`web/`) ใช้ `git -C web`

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `web/AGENTS.md` | Create | Root entry point — project overview, subproject index |
| `web/backend/AGENTS.md` | Create | Backend entry — stack, rules, done checklist, quick commands |
| `web/backend/docs/coding.md` | Create | Full code patterns + ✅/❌ examples (most critical) |
| `web/backend/docs/project-structure.md` | Create | Directory map |
| `web/backend/docs/add-feature.md` | Create | Step-by-step new feature guide |
| `web/backend/docs/gotchas.md` | Create | Actual gotchas — filled from workspace rules |
| `web/backend/docs/testing.md` | Create | Test patterns |
| `web/backend/docs/authorization.md` | Create | Policy table + how to apply |
| `web/frontend/AGENTS.md` | Create | Frontend entry — stack, rules, done checklist |
| `web/frontend/docs/coding.md` | Create | Full code patterns + genericHooks ✅/❌ (most critical) |
| `web/frontend/docs/project-structure.md` | Create | Directory map |
| `web/frontend/docs/add-feature.md` | Create | Step-by-step new feature guide |
| `web/frontend/docs/gotchas.md` | Create | Actual gotchas — filled from workspace rules |
| `web/frontend/docs/components.md` | Create | UI component patterns |
| `web/frontend/docs/routing.md` | Create | App Router routing guide |
| `web/wiki/_gotchas.md` | Update | Fill with real cross-cutting issues |
| `.claude/agents/dotnet-developer.md` | Update | Thin wrapper — points to web/backend/AGENTS.md |
| `.claude/agents/frontend-developer.md` | Update | Thin wrapper — points to web/frontend/AGENTS.md |
| `CLAUDE.md` | Update | Add new doc structure section |

---

## Task 1: Create branch in web/ submodule

**Files:** (none — branch setup only)

- [ ] **Step 1.1: Create branch**

```bash
git -C web checkout -b chore/ai-agent-docs-hybrid
```

Expected: `Switched to a new branch 'chore/ai-agent-docs-hybrid'`

- [ ] **Step 1.2: Verify clean state**

```bash
git -C web status
```

Expected: `nothing to commit, working tree clean`

---

## Task 2: web/AGENTS.md — Root entry point

**Files:**
- Create: `web/AGENTS.md`

- [ ] **Step 2.1: Create root AGENTS.md**

Create `web/AGENTS.md` with this exact content:

```markdown
# SAM — AI Agent Entry Point

SAM (Sales Approval Management) — price proposal and approval workflow system.

Read this file first. Then open the sub-project AGENTS.md for your target area.

## Rules

- **Load docs selectively.** Open the sub-project AGENTS.md first. Load additional docs only when the task needs them.
- **Never guess patterns.** Read the relevant doc or an existing file in the target sub-project.
- **Never edit files in both backend/ and frontend/ in the same task** — scope per task to one sub-project.
- **All git commands use `git -C web`.** This repo is a submodule.

## Sub-Projects

| Directory | Purpose | Port |
|-----------|---------|------|
| `backend/` | .NET 10 REST API — proposal lifecycle, approval workflow, rebate, SAP sync, Hangfire jobs | 5000 |
| `frontend/` | Next.js 15 App Router — proposal creation, approval, reports, master data | 3000 |

## Docs Index

| Doc | When to load |
|-----|-------------|
| [backend/AGENTS.md](backend/AGENTS.md) | Working in backend |
| [frontend/AGENTS.md](frontend/AGENTS.md) | Working in frontend |
| [wiki/_index.md](wiki/_index.md) | Feature catalog — list of all features |
| [wiki/_overview.md](wiki/_overview.md) | Architecture overview |
| [wiki/_gotchas.md](wiki/_gotchas.md) | Cross-cutting issues — read when debugging |

## Business Domain

**Core flow:**
```
Sale Rep creates Proposal → Submit (Pending) → Approval chain → Approved → Sync to SAP
```

**Proposal status:** Draft (1) → Pending (2) → Approved (3) / Rejected (4) / Skipped (5)

**Roles:** `srp` (Sale Rep), `sam` (Area Manager), `sdm` (Division Manager), `cdr` (Commercial Director), `pte` (Pricing Team), `fin` (Finance), `adt` (Auditor), `sla` (Sale Admin), `adm` (System Admin)
```

- [ ] **Step 2.2: Verify file exists**

```bash
git -C web status
```

Expected: `web/AGENTS.md` appears as new file

- [ ] **Step 2.3: Commit**

```bash
git -C web add AGENTS.md
git -C web commit -m "docs: add root AGENTS.md entry point for AI agents"
```

---

## Task 3: web/backend/AGENTS.md — Backend entry

**Files:**
- Create: `web/backend/AGENTS.md`

- [ ] **Step 3.1: Create directory if needed**

```bash
New-Item -ItemType Directory -Path "web/backend/docs" -Force
```

- [ ] **Step 3.2: Create web/backend/AGENTS.md**

Create `web/backend/AGENTS.md` with this exact content:

```markdown
# SamApp.WebApi — Backend AI Agent Entry Point

.NET 10 REST API for SAM price approval system. Read this file first when working in backend.

## Rules

- **Load docs selectively.** Always load `docs/coding.md` as baseline. Load others only when the task needs them — see Docs Index.
- **Always build after changes.** Run `dotnet build` after every code change.
- **Never guess patterns.** Read `docs/coding.md` or an existing feature in `SamApp.WebApi/Features/` as reference.
- **VSA pattern.** Each use case lives in `Features/{Domain}/{Operation}/` with its own endpoint file and command-handler file. Do NOT create controllers.
- **Migrations required for schema changes.** Run `dotnet ef migrations add <Name> --project SamApp.WebApi`.

## Quick Commands

| Command | Description |
|---------|-------------|
| `dotnet run --project SamApp.WebApi` | Run API (port 5000) |
| `dotnet build` | Build solution |
| `dotnet test` | Run all tests |
| `dotnet test --filter "ClassName"` | Run specific test class |
| `dotnet ef migrations add <Name> --project SamApp.WebApi` | Add EF Core migration |
| `dotnet ef database update --project SamApp.WebApi` | Apply migrations |

## Stack

- **.NET 10**, C# — latest language features
- **Carter** — endpoint routing (`ICarterModule`)
- **MediatR** — CQRS (`IRequest`, `IRequestHandler`)
- **EF Core 10** + **Dapper** — data access
- **SQL Server** — database
- **FluentValidation** — validation (`AbstractValidator<T>`)
- **Mapster** — object mapping (`entity.Adapt<TDto>()`)
- **Hangfire** — background jobs
- **MinIO** — file storage
- **Serilog** — structured logging
- **ASP.NET Identity** — user management

## System Overview

**Domain areas:** Auth, Proposal, Approval, ApprovalSettings, CustomerGroup, CustomerRelation, Rebates, CloseMonths, Region, Report, SapSync, File, Jobs, Notification, User, Role

**Key entities:** Proposal, ProposalDetail, ProposalCustomer, ApprovalHistory, CustomerGroup, Agreement, CloseMonth, BatchJob

**External integrations:** Minio (file storage), SAP RFC (sapnco), SMTP email (SamApp.Externals.Email), Hangfire (jobs), Redis (cache)

## Docs Index

| Doc | When to load |
|-----|-------------|
| [docs/coding.md](docs/coding.md) | **Always** — baseline patterns |
| [docs/project-structure.md](docs/project-structure.md) | When navigating the codebase |
| [docs/add-feature.md](docs/add-feature.md) | When adding a new feature/operation |
| [docs/authorization.md](docs/authorization.md) | When adding/changing endpoint permissions |
| [docs/testing.md](docs/testing.md) | When writing tests |
| [docs/gotchas.md](docs/gotchas.md) | When debugging or confused |
| [SamApp.WebApi/Program.cs](SamApp.WebApi/Program.cs) | App composition root, auth policies |
| [SamApp.WebApi/Database/SamAppDbContext.cs](SamApp.WebApi/Database/SamAppDbContext.cs) | All EF entity sets |

## Done Checklist

After every task, verify:

- [ ] `dotnet build` passes (zero errors)
- [ ] `dotnet test` passes (no regressions)
- [ ] Migration generated and applied (if schema changed)
- [ ] Endpoint has `.RequireAuthorization()` or correct policy
- [ ] Audit fields set (`CreatedDateUTC`, `CreatedBy`, `UpdatedDateUTC`, `UpdatedBy`)
- [ ] All DB calls use `async/await` with `CancellationToken ct`
```

- [ ] **Step 3.3: Commit**

```bash
git -C web add backend/AGENTS.md
git -C web commit -m "docs: add backend/AGENTS.md with stack, rules, done checklist"
```

---

## Task 4: web/backend/docs/coding.md — Code patterns (CRITICAL)

**Files:**
- Create: `web/backend/docs/coding.md`

> ⚠️ This is the most critical file. The branch had WRONG patterns (4-file split). The correct pattern uses 2 files per operation: `{Operation}Endpoint.cs` and `{Operation}CommandHandler.cs`.

- [ ] **Step 4.1: Create web/backend/docs/coding.md**

Create `web/backend/docs/coding.md` with this exact content:

```markdown
# Coding Conventions — Backend

## Architecture: Vertical Slice

Each use case = one folder, two files. Do NOT create controllers or repositories.

```
Features/{Domain}/{Operation}/
├── {Operation}Endpoint.cs        ← Carter route + FluentValidation validator
└── {Operation}CommandHandler.cs  ← MediatR handler + Command/Result/Response records
```

Example: `Features/Proposal/Create/`
- `CreateEndpoint.cs`
- `CreateCommandHandler.cs`

## Endpoint Pattern (Carter + FluentValidation)

`{Operation}Endpoint.cs` contains TWO things: the route and the validator.

```csharp
namespace SamApp.WebApi.Features.Proposal.Create;

public class CreateEndpoints : ICarterModule
{
    public void AddRoutes(IEndpointRouteBuilder app)
    {
        app.MapPost("/requests", async (IMediator mediator, CreateCommand command) =>
        {
            var result = await mediator.Send(command);
            return result.Succeeded
                ? Results.Ok(new CreateResponse("Success"))
                : Results.BadRequest(new { error = result.Message });
        })
        .WithTags("Proposal")
        .WithSummary("Create a new price proposal")
        .Produces<CreateResponse>(StatusCodes.Status200OK)
        .RequireAuthorization("CreateProposal");
    }
}

public class CreateValidator : AbstractValidator<CreateCommand>
{
    public CreateValidator()
    {
        RuleFor(x => x.SalesOrgId).NotEmpty().WithMessage("SalesOrgId is required");
        RuleFor(x => x.Month).InclusiveBetween(1, 12);
        RuleFor(x => x.Year).GreaterThan(2000);
    }
}
```

Carter auto-discovers all `ICarterModule` implementations — no manual registration needed.

## Handler + Contracts Pattern

`{Operation}CommandHandler.cs` contains FOUR things: handler, command, result, response.

```csharp
namespace SamApp.WebApi.Features.Proposal.Create;

// Handler
public class CreateCommandHandler(SamAppDbContext db, IHttpContextAccessor http)
    : IRequestHandler<CreateCommand, CreateResult>
{
    public async Task<CreateResult> Handle(CreateCommand request, CancellationToken ct)
    {
        var userId = http.HttpContext!.User.FindFirstValue(ClaimTypes.NameIdentifier)!;
        
        var proposal = new Proposal
        {
            Id = Guid.NewGuid(),
            SalesOrgId = request.SalesOrgId,
            Month = request.Month,
            Year = request.Year,
            Status = ProposalStatus.Draft,
            CreatedDateUTC = DateTime.UtcNow,  // ✅ always UtcNow
            CreatedBy = userId,
            UpdatedDateUTC = DateTime.UtcNow,
            UpdatedBy = userId,
        };
        
        db.Proposals.Add(proposal);
        await db.SaveChangesAsync(ct);
        
        return CreateResult.Success(proposal.Id);
    }
}

// Command (input)
public record CreateCommand(
    [property: Required] string SalesOrgId,
    int Month,
    int Year
) : IRequest<CreateResult>;

// Result (internal — handler returns this)
public record CreateResult(bool Succeeded, Guid? Id = null, string? Message = null)
{
    public static CreateResult Success(Guid id) => new(true, id);
    public static CreateResult Fail(string msg) => new(false, null, msg);
}

// Response (external — what the API returns)
public record CreateResponse(string Message, Guid? Id = null);
```

## Database Access (EF Core)

```csharp
// ✅ Correct — async with CancellationToken
var proposal = await db.Proposals
    .FirstOrDefaultAsync(p => p.Id == id, ct)
    ?? throw new NotFoundException($"Proposal {id} not found");

// ✅ Correct — FindAsync for PK lookup
var proposal = await db.Proposals.FindAsync([id], ct);

// ✅ Correct — multi-step in transaction
await using var tx = await db.Database.BeginTransactionAsync(ct);
db.Proposals.Add(entity);
db.ApprovalHistories.Add(history);
await db.SaveChangesAsync(ct);
await tx.CommitAsync(ct);

// ❌ Wrong — blocking call
var proposal = db.Proposals.Find(id);

// ❌ Wrong — no cancellation token
var result = await db.Proposals.FirstOrDefaultAsync(p => p.Id == id);
```

## Mapping (Mapster)

```csharp
// ✅ Simple projection
var response = entity.Adapt<ProposalResponse>();
var list = entities.Adapt<List<ProposalResponse>>();

// ✅ Custom mapping — configure in MapsterConfig class, not inline
```

## Business Rule Violations

```csharp
// ✅ Correct — throw ApiValidationException for business rules
if (proposal.Status != ProposalStatus.Draft)
    throw new ApiValidationException("Only draft proposals can be submitted");

// ❌ Wrong — generic exception
throw new Exception("Cannot submit");

// ❌ Wrong — InvalidOperationException
throw new InvalidOperationException("Cannot submit");
```

## Getting Current User

```csharp
// ✅ Correct — inject IHttpContextAccessor, read from claims
public class CreateCommandHandler(SamAppDbContext db, IHttpContextAccessor http)
{
    var userId = http.HttpContext!.User.FindFirstValue(ClaimTypes.NameIdentifier)!;
    var userRole = http.HttpContext!.User.FindFirstValue(ClaimTypes.Role)!;
}

// ❌ Wrong — don't pass userId in the command from the client
public record CreateCommand(string UserId, ...) // ← security risk
```

## Audit Fields — Always Set

Every entity write must set all four audit fields:

```csharp
// ✅ Correct
entity.CreatedDateUTC = DateTime.UtcNow;
entity.CreatedBy = userId;
entity.UpdatedDateUTC = DateTime.UtcNow;
entity.UpdatedBy = userId;

// ❌ Wrong — DateTime.Now (timezone-dependent)
entity.CreatedDateUTC = DateTime.Now;
```

## Query (read-only) Pattern

For queries that only read data, same 2-file structure:

```csharp
// GetByIdEndpoint.cs
app.MapGet("/requests/{id}", async (Guid id, IMediator mediator) =>
{
    var result = await mediator.Send(new GetByIdQuery(id));
    return result is null ? Results.NotFound() : Results.Ok(result);
})
.RequireAuthorization();

// GetByIdQueryHandler.cs
public record GetByIdQuery(Guid Id) : IRequest<ProposalResponse?>;

public class GetByIdQueryHandler(SamAppDbContext db)
    : IRequestHandler<GetByIdQuery, ProposalResponse?>
{
    public async Task<ProposalResponse?> Handle(GetByIdQuery request, CancellationToken ct)
    {
        return await db.Proposals
            .Where(p => p.Id == request.Id)
            .ProjectToType<ProposalResponse>()  // Mapster projection
            .FirstOrDefaultAsync(ct);
    }
}
```

## Naming

| Operation type | Naming |
|---------------|--------|
| Read | `Get`, `Search`, `GetOptions`, `GetAll` |
| Write | `Create`, `Update`, `Delete`, `Submit`, `Patch`, `Approve`, `Reject` |
| Background | `Sync`, `Calculate`, `Send` |
```

- [ ] **Step 4.2: Commit**

```bash
git -C web add backend/docs/coding.md
git -C web commit -m "docs: add backend/docs/coding.md with correct VSA patterns and anti-patterns"
```

---

## Task 5: web/backend/docs/gotchas.md

**Files:**
- Create: `web/backend/docs/gotchas.md`

- [ ] **Step 5.1: Create web/backend/docs/gotchas.md**

```markdown
# Gotchas — Backend

Common mistakes and surprises. Read when debugging or before starting a new feature.

## ❌ DateTime.Now vs ✅ DateTime.UtcNow

```csharp
// ❌ Wrong — timezone-dependent, breaks on server with different TZ
entity.CreatedAt = DateTime.Now;

// ✅ Correct
entity.CreatedAt = DateTime.UtcNow;
```

All timestamp columns are named `*UTC` — a hint to always use `DateTime.UtcNow`.

## ❌ Missing Audit Fields

EF Core will throw or data will be null if you forget to set audit fields:

```csharp
// ❌ Wrong — missing audit fields
db.Proposals.Add(new Proposal { Name = request.Name });

// ✅ Correct
db.Proposals.Add(new Proposal
{
    Name = request.Name,
    CreatedDateUTC = DateTime.UtcNow,
    CreatedBy = userId,
    UpdatedDateUTC = DateTime.UtcNow,
    UpdatedBy = userId,
});
```

## ❌ Carter Auto-Discovery

Carter discovers all `ICarterModule` via DI scan — **never manually register** an endpoint module.

```csharp
// ❌ Wrong — don't do this
builder.Services.AddSingleton<CreateEndpoints>();

// ✅ Correct — Carter finds it automatically via AddCarter()
// Already configured in Program.cs
```

If your endpoint doesn't appear in Swagger, check: (1) implements `ICarterModule`, (2) correct namespace, (3) `dotnet build` with no errors.

## ❌ FluentValidation Not Wired

FluentValidation is wired globally via DI. If validation isn't triggering:
1. Confirm `AbstractValidator<TCommand>` is in the same assembly
2. Check `AddFluentValidation()` is called in Program.cs
3. Validator class must be `public`

## ❌ Missing Migration After Schema Change

If you add/modify an entity and forget to run the migration, EF will throw at runtime.

Always after entity changes:
```bash
dotnet ef migrations add <DescriptiveName> --project SamApp.WebApi
dotnet ef database update --project SamApp.WebApi
```

## ❌ Generic Exception Instead of ApiValidationException

```csharp
// ❌ Wrong — returns 500
throw new Exception("Proposal is already approved");

// ✅ Correct — returns 400 with structured error
throw new ApiValidationException("Proposal is already approved");
```

## ❌ No Authorization on Endpoint

Every endpoint must have `.RequireAuthorization()` or a specific policy. No exception.

```csharp
// ❌ Wrong — public endpoint by accident
app.MapPost("/proposals", handler).WithTags("Proposal");

// ✅ Correct
app.MapPost("/proposals", handler)
   .WithTags("Proposal")
   .RequireAuthorization("CreateProposal");

// ✅ Also correct — any authenticated user
   .RequireAuthorization();
```

## ❌ .Result or .Wait() on Async

```csharp
// ❌ Wrong — deadlocks in ASP.NET
var result = handler.Handle(cmd, ct).Result;

// ✅ Correct
var result = await handler.Handle(cmd, ct);
```

## ❌ Multi-Step DB Write Without Transaction

```csharp
// ❌ Wrong — partial failure leaves DB inconsistent
db.Proposals.Add(proposal);
await db.SaveChangesAsync(ct);
db.ApprovalHistories.Add(history);  // if this throws, proposal exists without history
await db.SaveChangesAsync(ct);

// ✅ Correct
await using var tx = await db.Database.BeginTransactionAsync(ct);
db.Proposals.Add(proposal);
db.ApprovalHistories.Add(history);
await db.SaveChangesAsync(ct);
await tx.CommitAsync(ct);
```
```

- [ ] **Step 5.2: Commit**

```bash
git -C web add backend/docs/gotchas.md
git -C web commit -m "docs: add backend/docs/gotchas.md with real antipatterns"
```

---

## Task 6: web/backend/docs/ — Remaining docs

**Files:**
- Create: `web/backend/docs/project-structure.md`
- Create: `web/backend/docs/add-feature.md`
- Create: `web/backend/docs/testing.md`
- Create: `web/backend/docs/authorization.md`

- [ ] **Step 6.1: Create project-structure.md**

Copy content from branch (already accurate):
```bash
git show origin/feature/omega-generate-ai-support:web/backend/docs/project-structure.md > web/backend/docs/project-structure.md
```

- [ ] **Step 6.2: Create add-feature.md**

Copy from branch and update file-naming section to use 2-file pattern (not 4):
```bash
git show origin/feature/omega-generate-ai-support:web/backend/docs/add-feature.md > web/backend/docs/add-feature.md
```

Then edit to replace the 4-file slice structure with the correct 2-file pattern. Find the section:
```
├── {Operation}Endpoint.cs    # HTTP
├── {Operation}Command.cs     # MediatR IRequest
├── {Operation}Handler.cs     # IRequestHandler
└── {Operation}Validator.cs   # FluentValidation
```

Replace with:
```
├── {Operation}Endpoint.cs       # Carter route + FluentValidation validator
└── {Operation}CommandHandler.cs # MediatR handler + Command/Result/Response
```

- [ ] **Step 6.3: Create testing.md**

Copy from branch (accurate enough):
```bash
git show origin/feature/omega-generate-ai-support:web/backend/docs/testing.md > web/backend/docs/testing.md
```

- [ ] **Step 6.4: Create authorization.md**

Copy from branch (accurate — policy table is correct):
```bash
git show origin/feature/omega-generate-ai-support:web/backend/docs/authorization.md > web/backend/docs/authorization.md
```

- [ ] **Step 6.5: Commit all**

```bash
git -C web add backend/docs/
git -C web commit -m "docs: add backend/docs/ — project-structure, add-feature, testing, authorization"
```

---

## Task 7: web/frontend/AGENTS.md

**Files:**
- Create: `web/frontend/AGENTS.md`

- [ ] **Step 7.1: Create web/frontend/AGENTS.md**

```markdown
# SAM Frontend — AI Agent Entry Point

Next.js 15 App Router web UI for SAM price approval system. Read this file first when working in frontend.

## Rules

- **Load docs selectively.** Always load `docs/coding.md` as baseline. Load others only when needed.
- **Always lint after changes.** Run `npm run lint` after every code change.
- **Never guess patterns.** Read `docs/coding.md` or an existing feature in `src/features/` as reference.
- **Feature-first structure.** All domain code lives in `src/features/{domain}/`. Do not add domain logic to `src/components/` or root `src/hooks/`.
- **Server Components by default.** Use `"use client"` only when interactivity is required.
- **React Query for all API calls.** Use `genericHooks` — never `fetch` directly in components.

## Quick Commands

| Command | Description |
|---------|-------------|
| `npm run dev:local` | Run with local env vars (port 3000) |
| `npm run dev:development` | Run with dev environment |
| `npm run build` | Production build |
| `npm run lint` | ESLint check |
| `npm run mock` | Run with MSW mock API |

## Stack

- **Next.js 15** App Router, **React 19**, **TypeScript** strict
- **Tailwind CSS v4** + **Radix UI** — styling & primitives
- **TanStack Query v5** — server state
- **Zustand** — client state
- **React Hook Form** + **Zod v4** — forms & validation
- **TanStack Table** — data tables
- **Sonner** — toast notifications
- **Dayjs** — date handling

## System Overview

**Domain areas:** auth, approval, customers, master-data, org-chart, rebate, report, request, roles, sap-sync, settings, topbar

**Key frontend state:** Proposal, ApprovalHistory, CustomerGroup, Rebate, User

**API integration:** Backend API via Next.js gateway proxy (`/api/gateway/proxy/*`) and direct server calls (`BACKEND_URL`)

## Docs Index

| Doc | When to load |
|-----|-------------|
| [docs/coding.md](docs/coding.md) | **Always** — baseline patterns |
| [docs/project-structure.md](docs/project-structure.md) | When navigating the codebase |
| [docs/add-feature.md](docs/add-feature.md) | When adding a new feature domain |
| [docs/routing.md](docs/routing.md) | When adding pages or routes |
| [docs/components.md](docs/components.md) | When building UI components |
| [docs/gotchas.md](docs/gotchas.md) | When debugging or confused |
| [src/middleware.ts](src/middleware.ts) | Route protection, role-based redirect |
| [src/shared/constants/permissions.ts](src/shared/constants/permissions.ts) | ROLE_PERMISSIONS and ROLE_REDIRECTS maps |
| [src/lib/invalidate.relations.ts](src/lib/invalidate.relations.ts) | Cache invalidation registry |

## Done Checklist

After every task, verify:

- [ ] `npm run lint` passes (zero errors)
- [ ] Page added to correct route group (`(protected)` or `(public)`)
- [ ] API calls use `genericHooks` — no raw `fetch` or `apiRequest` in components
- [ ] Types defined in `types/` layer
- [ ] Mutations called with `{ body: data }` — not raw `mutate(data)`
- [ ] `useWatch()` used — not `watch()` in child components
- [ ] `dynamic()` + `Suspense` wrapper on page component
- [ ] MSW mock added if feature needs offline/mock dev (`src/mocks/`)
```

- [ ] **Step 7.2: Commit**

```bash
git -C web add frontend/AGENTS.md
git -C web commit -m "docs: add frontend/AGENTS.md with stack, rules, done checklist"
```

---

## Task 8: web/frontend/docs/coding.md — Code patterns (CRITICAL)

**Files:**
- Create: `web/frontend/docs/coding.md`

> ⚠️ The branch's coding.md used raw `apiClient.get` / `useMutation` — WRONG. This codebase uses `genericHooks`. This file must be written from workspace content, not copied from the branch.

- [ ] **Step 8.1: Create web/frontend/docs/coding.md**

Create `web/frontend/docs/coding.md` with this exact content:

```markdown
# Coding Conventions — Frontend

## Feature Structure

All domain code in `src/features/{domain}/`. Never put domain logic in `src/components/` or root `src/hooks/`.

```
features/{domain}/
├── components/     # React components for this domain
├── hooks/          # API hooks (useGet/usePost wrappers)
├── types/          # TypeScript interfaces for API contracts
├── schema/         # Zod schemas for forms
├── constants/      # Feature constants & enums
├── mapper/         # Data transform functions (API → UI model)
├── utils/          # Utility functions
└── __mocks__/      # MSW mock handlers (if feature uses mocks)
```

## Page Pattern — Always dynamic() + Suspense

Every page in `app/(protected)/` MUST use this pattern:

```tsx
// src/app/(protected)/request/page.tsx
import dynamic from 'next/dynamic';
import { Suspense } from 'react';
import { Loading } from '@/components/Loading';

const RequestWrapper = dynamic(
  () => import('@/features/request/components/RequestWrapper')
);

export default function Page() {
  return (
    <Suspense fallback={<Loading isLoading={true} />}>
      <RequestWrapper />
    </Suspense>
  );
}
```

Dynamic route with params:
```tsx
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <Suspense fallback={<Loading isLoading={true} />}>
      <RequestDetailWrapper id={id} />
    </Suspense>
  );
}
```

## API Hooks — Use genericHooks (NEVER fetch directly)

Import from `@/lib/genericHooks`:

```typescript
import {
  useGet,        // single GET by URL
  useGetById,    // GET /route/:id
  useList,       // GET /route?params (list with pagination)
  usePost,       // POST (create)
  usePatch,      // PATCH (partial update)
  usePut,        // PUT (full update)
  useDelete,     // DELETE by URL
  useDeleteById, // DELETE /route/:id
} from '@/lib/genericHooks';
```

### GET hooks pattern

```typescript
// features/request/hooks/use-request.ts
const API_BASE = '/requests';

// List with search params
export const useGetRequests = (params?: RequestSearchParams) =>
  useList<RequestListResponse>(API_BASE, params, {
    staleTime: 0,
    placeholderData: keepPreviousData, // ✅ always for paginated lists
  });

// Single resource by ID
export const useGetRequestById = (id: string, enabled = true) =>
  useGetById<RequestDetailResponse>(API_BASE, id, {
    enabled: !!id && enabled,
    staleTime: 0,
    refetchOnMount: 'always',
  });

// Conditional (disabled until dep is ready)
export const useGetOptions = (salesOrgId?: string) => {
  const enabled = !!salesOrgId;
  return useGet<OptionsResponse>(
    enabled ? `${API_BASE}/options` : undefined,
    enabled ? { salesOrgId } : undefined,
    { enabled, staleTime: 0 }
  );
};
```

### Mutation hooks + calling pattern

```typescript
// POST
export const useCreateRequest = () =>
  usePost<RequestResponse, CreateRequestBody>(API_BASE, undefined, {
    list: true,  // invalidate GET /requests?... after success
  });

// PATCH
export const useUpdateRequest = (id: string) =>
  usePatch<RequestResponse, UpdateRequestBody>(
    `${API_BASE}/${id}`,
    undefined,
    { list: true, detail: true, related: true }
  );

// DELETE
export const useDeleteRequest = (id: string) =>
  useDeleteById<void>(API_BASE, id, undefined, { list: true });
```

**Calling mutations — ALWAYS `{ body: data }`:**

```typescript
const { mutateAsync: create } = useCreateRequest();
const { mutateAsync: update } = useUpdateRequest(id);

// ✅ Correct
await create({ body: payload });
await update({ body: partialPayload });

// ❌ Wrong — will silently fail or throw
await create(payload);
await update(partialPayload);
```

### POST-based search (when API uses POST for search)

```typescript
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';

export const useApprovalSearch = (body: ApprovalSearchRequest) =>
  useQuery({
    queryKey: ['approval-search', body],
    queryFn: () => apiRequest<ApprovalSearchResponse>('POST', '/approval/search', body),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
```

## Form Pattern

### Simple form

```tsx
'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { useServerErrorsConfigured } from '@/lib/server-errors-context';

export function RequestForm({ onSuccess }: { onSuccess?: () => void }) {
  const form = useForm<RequestFormValues>({
    resolver: zodResolver(requestSchema),
    defaultValues: { salesOrgId: '', month: 1, year: 2025 },
    mode: 'onSubmit',
  });
  const { apply } = useServerErrorsConfigured(form);
  const { mutateAsync: create, isPending } = useCreateRequest();

  const handleSubmit = form.handleSubmit(async (data) => {
    try {
      await create({ body: data });
      toast.success('บันทึกสำเร็จ');   // ✅ Thai messages
      onSuccess?.();
    } catch (error) {
      apply(error);  // ✅ maps BE validation errors → form field errors
    }
  });

  return (
    <form onSubmit={handleSubmit}>
      {/* fields */}
      <Button type="submit" disabled={isPending}>
        {isPending ? 'กำลังบันทึก...' : 'บันทึก'}
      </Button>
    </form>
  );
}
```

### Multi-component form (Dialog owns state, children use FormContext)

```tsx
// Dialog.tsx — owns form state
'use client';
import { FormProvider, useForm } from 'react-hook-form';

export function RequestDialog({ open, onOpenChange }) {
  const form = useForm<RequestFormValues>({
    resolver: zodResolver(requestSchema),
    defaultValues,
    mode: 'onSubmit',
  });
  const { apply } = useServerErrorsConfigured(form);
  const { mutateAsync: create, isPending } = useCreateRequest();

  useEffect(() => {
    if (!open) form.reset(defaultValues);
  }, [open]);

  const handleSave = form.handleSubmit(async (data) => {
    try {
      await create({ body: data });
      toast.success('บันทึกสำเร็จ');
      onOpenChange(false);
    } catch (error) {
      apply(error);
    }
  });

  return (
    <FormProvider {...form}>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <RequestForm formId="request-form" onSubmit={handleSave} />
        <Button type="submit" form="request-form" disabled={isPending}>บันทึก</Button>
      </Dialog>
    </FormProvider>
  );
}

// ChildForm.tsx — reads form via context
'use client';
import { useFormContext, useWatch } from 'react-hook-form';

export function RequestForm({ formId, onSubmit }) {
  const { control } = useFormContext<RequestFormValues>();
  
  // ✅ useWatch — only re-renders THIS component
  const selectedType = useWatch({ control, name: 'type' });
  // ❌ watch() — re-renders entire parent tree on every keystroke
  // const selectedType = watch('type');
  
  return <form id={formId} onSubmit={onSubmit}>{/* fields */}</form>;
}
```

## Watching Form Values

```typescript
// ✅ Correct — only re-renders this component
const year = useWatch({ control, name: 'year' });
const [type, name] = useWatch({ control, name: ['type', 'name'] });

// ❌ Wrong — re-renders parent on every keystroke
const year = watch('year');
```

Cascading resets with useWatch:
```typescript
const prevYearRef = useRef(year);

useEffect(() => {
  if (prevYearRef.current !== year) {
    prevYearRef.current = year;
    resetField('month', { defaultValue: '' });
    resetField('customerGroupId', { defaultValue: '' });
  }
}, [year, resetField]);
```

## Zod Schema Pattern

```typescript
// src/features/request/schema/request.schema.ts
import { z } from 'zod';

export const requestSchema = z
  .object({
    mode: z.enum(['new', 'existing']),
    salesOrgId: z.string().min(1, 'กรุณาเลือก Sales Org'),
    month: z.number().min(1).max(12),
    year: z.number().min(2000),
    referenceId: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.mode === 'existing' && !data.referenceId) {
      ctx.addIssue({
        code: 'custom',
        message: 'กรุณาระบุรายการอ้างอิง',
        path: ['referenceId'],
      });
    }
  });

export type RequestFormValues = z.infer<typeof requestSchema>;
```

## Types Pattern

```typescript
// src/features/request/types/request-response.ts
export interface RequestDetailResponse {
  id: string;
  requestNo: string;
  status: number;
  salesOrgId: string;
  month: number;
  year: number;
  createdAt: string; // ISO string from backend
}

// src/features/request/types/request-request.ts
export interface CreateRequestBody {
  salesOrgId: string;
  month: number;
  year: number;
}
```

## Date Formatting

```typescript
// ✅ Correct
import dayjs from 'dayjs';
dayjs(dateString).format('DD/MM/YYYY');

// ❌ Wrong — locale/timezone dependent
new Date(dateString).toLocaleDateString();
```

## Rules Summary

| Rule | ✅ Do | ❌ Don't |
|------|-------|----------|
| API calls | `useGet`, `useList`, `usePost`, etc. | `fetch()` or `apiRequest` in components |
| Mutations | `mutate({ body: data })` | `mutate(data)` |
| Form watching | `useWatch({ control, name })` | `watch('name')` in child components |
| Pages | `dynamic()` + `Suspense` | Direct import of heavy components |
| Error mapping | `apply(error)` in catch | `console.error` only |
| Lists | `placeholderData: keepPreviousData` | No placeholder data |
| Toast messages | `toast.success('ภาษาไทย')` | `alert()` or English messages |
| Dates | `dayjs(d).format(...)` | `new Date().toLocaleDateString()` |
| Styles | Tailwind CSS only | Inline styles or CSS modules |
| Radix UI | Via `@/components/ui/` wrappers | Direct Radix import |
| TypeScript | `interface`/`type`, no `any` | `any` without comment |
```

- [ ] **Step 8.2: Commit**

```bash
git -C web add frontend/docs/coding.md
git -C web commit -m "docs: add frontend/docs/coding.md with genericHooks patterns and anti-patterns"
```

---

## Task 9: web/frontend/docs/gotchas.md

**Files:**
- Create: `web/frontend/docs/gotchas.md`

- [ ] **Step 9.1: Create web/frontend/docs/gotchas.md**

```markdown
# Gotchas — Frontend

Common mistakes. Read when debugging or before starting.

## ❌ mutate(data) vs ✅ mutate({ body: data })

```typescript
const { mutateAsync: create } = useCreateRequest();

// ❌ Wrong — will throw or silently do nothing
await create(payload);

// ✅ Correct
await create({ body: payload });
```

This is the #1 antipattern. The `genericHooks` wrapper expects `{ body: T }` format.

## ❌ watch() vs ✅ useWatch() in child components

```typescript
// ❌ Wrong — causes parent re-render on every keystroke
const { watch } = useFormContext();
const type = watch('type');

// ✅ Correct — only re-renders THIS component
const { control } = useFormContext();
const type = useWatch({ control, name: 'type' });
```

## ❌ Missing dynamic() + Suspense on pages

```tsx
// ❌ Wrong — blocks SSR, no loading state
import RequestWrapper from '@/features/request/components/RequestWrapper';
export default function Page() {
  return <RequestWrapper />;
}

// ✅ Correct
import dynamic from 'next/dynamic';
import { Suspense } from 'react';
const RequestWrapper = dynamic(() => import('@/features/request/components/RequestWrapper'));
export default function Page() {
  return <Suspense fallback={<Loading isLoading={true} />}><RequestWrapper /></Suspense>;
}
```

## ❌ Missing apply(error) in catch

```typescript
// ❌ Wrong — backend validation errors shown nowhere
try {
  await create({ body: data });
} catch (error) {
  console.error(error);  // user sees nothing
}

// ✅ Correct — maps BE field errors to form
try {
  await create({ body: data });
} catch (error) {
  apply(error);  // useServerErrorsConfigured maps errors to form fields
}
```

## ❌ Missing keepPreviousData on list queries

```typescript
// ❌ Wrong — table flickers to empty on every page/filter change
export const useGetRequests = (params) =>
  useList<RequestListResponse>(API_BASE, params, { staleTime: 0 });

// ✅ Correct — shows previous data while fetching
export const useGetRequests = (params) =>
  useList<RequestListResponse>(API_BASE, params, {
    staleTime: 0,
    placeholderData: keepPreviousData,
  });
```

## ❌ Direct Radix import vs ✅ @/components/ui/ wrappers

```tsx
// ❌ Wrong — bypasses project's customization and styling
import * as Dialog from '@radix-ui/react-dialog';

// ✅ Correct — use the project's wrapper
import { Dialog, DialogContent, DialogHeader } from '@/components/ui/dialog';
```

## ❌ new Date() for formatting vs ✅ dayjs

```typescript
// ❌ Wrong — locale/timezone dependent, inconsistent
new Date(dateStr).toLocaleDateString('th-TH');

// ✅ Correct
import dayjs from 'dayjs';
dayjs(dateStr).format('DD/MM/YYYY');
```

## ❌ English toast messages

```typescript
// ❌ Wrong — UI is Thai language
toast.success('Saved successfully');

// ✅ Correct
toast.success('บันทึกสำเร็จ');
toast.error('เกิดข้อผิดพลาด กรุณาลองใหม่');
```

## ❌ Domain logic in src/components/

```
// ❌ Wrong — mixing shared UI with domain logic
src/components/RequestTable.tsx  ← has API calls and business rules

// ✅ Correct
src/features/request/components/RequestTable.tsx
```

## ❌ "use client" on pages

```tsx
// ❌ Wrong — prevents SSR optimization
'use client';
export default function Page() { ... }

// ✅ Correct — page is Server Component, only Wrapper is client
export default function Page() {
  return <Suspense ...><RequestWrapper /></Suspense>;
}
// RequestWrapper.tsx has 'use client' if it needs hooks
```

## ❌ any type

```typescript
// ❌ Wrong — hides type errors
const data: any = response;

// ✅ Correct — define interface or use unknown + narrow
const data: RequestDetailResponse = response;
```

## Invalidation: When to add related: true

After a mutation, check `src/lib/invalidate.relations.ts`. If the endpoint you're mutating has related endpoints registered, pass `related: true` to auto-invalidate them:

```typescript
// ✅ Before using related: true, verify it's in invalidate.relations.ts
export const useSubmitRequest = (id: string) =>
  usePatch<void, void>(`/requests/${id}/submit`, undefined, {
    list: true,
    detail: true,
    related: true,  // ← only if registered in invalidate.relations.ts
  });
```
```

- [ ] **Step 9.2: Commit**

```bash
git -C web add frontend/docs/gotchas.md
git -C web commit -m "docs: add frontend/docs/gotchas.md with real antipatterns"
```

---

## Task 10: web/frontend/docs/ — Remaining docs

**Files:**
- Create: `web/frontend/docs/project-structure.md`
- Create: `web/frontend/docs/add-feature.md`
- Create: `web/frontend/docs/routing.md`
- Create: `web/frontend/docs/components.md`

- [ ] **Step 10.1: Copy accurate docs from branch**

```bash
git show origin/feature/omega-generate-ai-support:web/frontend/docs/project-structure.md > web/frontend/docs/project-structure.md
git show origin/feature/omega-generate-ai-support:web/frontend/docs/routing.md > web/frontend/docs/routing.md
git show origin/feature/omega-generate-ai-support:web/frontend/docs/components.md > web/frontend/docs/components.md
```

- [ ] **Step 10.2: Create add-feature.md from branch but fix API hook section**

```bash
git show origin/feature/omega-generate-ai-support:web/frontend/docs/add-feature.md > web/frontend/docs/add-feature.md
```

Then find the API hook example in `add-feature.md` that shows `apiClient.get` or raw `useMutation` and replace with `genericHooks` pattern from `docs/coding.md` Task 8 step 1 (GET hooks / mutation hooks sections).

- [ ] **Step 10.3: Commit**

```bash
git -C web add frontend/docs/
git -C web commit -m "docs: add frontend/docs/ — project-structure, add-feature, routing, components"
```

---

## Task 11: web/wiki/_gotchas.md — Fill with real content

**Files:**
- Modify: `web/wiki/_gotchas.md`

- [ ] **Step 11.1: Update wiki gotchas**

The branch file is empty. Replace with:

```markdown
# Gotchas

Cross-cutting issues affecting multiple features or shared infrastructure.

## Git — Always use `git -C web`

This repo is a submodule. All git operations inside it must prefix `git -C web`:

```bash
# ✅ Correct
git -C web status
git -C web checkout -b feature/SAM-123-desc
git -C web add .
git -C web commit -m "feat: ..."
git -C web push

# ❌ Wrong — operates on parent workspace repo
git status
git checkout -b feature/SAM-123-desc
```

## Path references: web/ vs backend/ vs SamApp.WebApi/

| Context | Path prefix |
|---------|------------|
| From workspace root | `web/backend/SamApp.WebApi/` |
| From inside `web/` submodule | `backend/SamApp.WebApi/` |
| In AGENTS.md relative links | `SamApp.WebApi/` |

When an AGENTS.md file says `Features/Proposal/`, it means `backend/SamApp.WebApi/Features/Proposal/` from the web/ root.

## Backend: DateTime.UtcNow only

All timestamps in this codebase are stored as UTC. Never use `DateTime.Now`.

See [backend/docs/gotchas.md](../backend/docs/gotchas.md) for full list.

## Frontend: mutate({ body: data }) not mutate(data)

All `genericHooks` mutations require `{ body: data }` format.

See [frontend/docs/gotchas.md](../frontend/docs/gotchas.md) for full list.

## Proposal Status Numbers

```
1 = Draft
2 = Pending  
3 = Approved
4 = Rejected
5 = Skipped
```

Backend uses these as int enum. Frontend compares against these numbers in status badges and filters.

## Approval: Two Parallel Tracks

Approval has two separate workflows with separate endpoints:
- **SAM track:** `POST /approval/search/sam`, `GET /approval/sam/{id}`
- **SDM track:** `POST /approval/search/sdm`, `GET /approval/sdm/{id}`

Do not mix these tracks when building approval features.
```

- [ ] **Step 11.2: Commit**

```bash
git -C web add wiki/_gotchas.md
git -C web commit -m "docs: fill wiki/_gotchas.md with cross-cutting gotchas"
```

---

## Task 12: Update .claude/agents/ — Thin wrappers

**Files:**
- Modify: `.claude/agents/dotnet-developer.md` (workspace, not web/)
- Modify: `.claude/agents/frontend-developer.md` (workspace, not web/)

> These files now serve as orchestration-level stubs. Core patterns live in the codebase. Agents should read `web/backend/AGENTS.md` or `web/frontend/AGENTS.md` first.

- [ ] **Step 12.1: Update dotnet-developer.md**

Keep the frontmatter and persona. Replace the body with a redirect to the in-repo docs:

```markdown
---
name: dotnet-developer
description: Use when creating or modifying backend code — API endpoints, EF Core entities, migrations, Hangfire jobs, or any C# code in SamApp.WebApi
tools: Read, Edit, Write, Glob, Grep, Bash
model: sonnet
---

You are a **Senior .NET Developer** for the SAM project.

## First Step — ALWAYS

Before writing any code, read these files in order:
1. `web/backend/AGENTS.md` — rules, stack, done checklist, quick commands
2. `web/backend/docs/coding.md` — code patterns (VSA, Carter, MediatR, EF Core)

Then load additional docs from `web/backend/docs/` as needed for your specific task.

## Working Directory

All backend code is in `web/backend/SamApp.WebApi/`. All commands run from workspace root with `dotnet` targeting that project.

## Git

```bash
git -C web checkout -b feature/SAM-XXX-description
git -C web add .
git -C web commit -m "feat: ..."
git -C web push
```

## After Completing

Follow the Done Checklist in `web/backend/AGENTS.md` before reporting complete.
```

- [ ] **Step 12.2: Update frontend-developer.md**

Keep the frontmatter and persona. Replace the body with:

```markdown
---
name: frontend-developer
description: Use when creating or modifying frontend code — Next.js pages, React components, API hooks, forms, or TypeScript types in the frontend
tools: Read, Edit, Write, Glob, Grep, Bash
model: sonnet
---

You are a **Senior Frontend Developer** for the SAM project.

## First Step — ALWAYS

Before writing any code, read these files in order:
1. `web/frontend/AGENTS.md` — rules, stack, done checklist, quick commands
2. `web/frontend/docs/coding.md` — code patterns (genericHooks, forms, pages)

Then load additional docs from `web/frontend/docs/` as needed for your specific task.

## Working Directory

All frontend code is in `web/frontend/`. Commands run from `web/frontend/`.

## Git

```bash
git -C web checkout -b feature/SAM-XXX-description
git -C web add .
git -C web commit -m "feat: ..."
git -C web push
```

## After Completing

Follow the Done Checklist in `web/frontend/AGENTS.md` before reporting complete.
```

- [ ] **Step 12.3: Commit (workspace repo — NOT web/)**

```bash
git add .claude/agents/dotnet-developer.md .claude/agents/frontend-developer.md
git commit -m "docs: slim down agent files — patterns now live in web/backend/ and web/frontend/"
```

---

## Task 13: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (workspace root)

- [ ] **Step 13.1: Add AI docs structure section to CLAUDE.md**

Find the `## Key Paths` section and add a new section before it:

```markdown
## AI Agent Documentation Structure

Docs for AI agents live **inside the `web/` submodule** (version-controlled with code):

```
web/
  AGENTS.md                    ← Root entry point
  backend/
    AGENTS.md                  ← Backend entry (stack, rules, done checklist)
    docs/
      coding.md                ← ✅ Code patterns — VSA, Carter, MediatR, EF Core
      project-structure.md     ← Directory map
      add-feature.md           ← New feature guide
      authorization.md         ← Policy table
      testing.md               ← xUnit patterns
      gotchas.md               ← Common mistakes
  frontend/
    AGENTS.md                  ← Frontend entry (stack, rules, done checklist)
    docs/
      coding.md                ← ✅ Code patterns — genericHooks, forms, pages
      project-structure.md     ← Directory map
      add-feature.md           ← New feature guide
      routing.md               ← App Router routing
      components.md            ← UI component patterns
      gotchas.md               ← Common mistakes
  wiki/
    _index.md                  ← Feature catalog
    _overview.md               ← Architecture overview
    _gotchas.md                ← Cross-cutting issues
    raw/WEB-001..012.md        ← Per-feature documentation
```

`.claude/agents/` contains thin wrapper agents that delegate to the in-repo docs.
```

- [ ] **Step 13.2: Fix confusing path in CLAUDE.md**

Find `web/web/backend/` and `web/web/frontend/` references (the double-web paths are wrong for agents working inside the submodule). Update the Key Paths tables to add a note:

```markdown
> ⚠️ Paths below are from the **workspace root**. Inside the `web/` submodule, drop the leading `web/`.
```

- [ ] **Step 13.3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with AI agent doc structure and path clarification"
```

---

## Task 14: Push and open PR

- [ ] **Step 14.1: Push branch in web/ submodule**

```bash
git -C web push -u origin chore/ai-agent-docs-hybrid
```

- [ ] **Step 14.2: Verify final structure**

```bash
git -C web ls-files backend/AGENTS.md backend/docs/ frontend/AGENTS.md frontend/docs/ wiki/_gotchas.md
```

Expected output — all these files listed:
```
backend/AGENTS.md
backend/docs/add-feature.md
backend/docs/authorization.md
backend/docs/coding.md
backend/docs/gotchas.md
backend/docs/project-structure.md
backend/docs/testing.md
frontend/AGENTS.md
frontend/docs/add-feature.md
frontend/docs/coding.md
frontend/docs/components.md
frontend/docs/gotchas.md
frontend/docs/project-structure.md
frontend/docs/routing.md
wiki/_gotchas.md
```

- [ ] **Step 14.3: Push workspace changes**

```bash
git add .claude/agents/ CLAUDE.md
git push
```

---

## Self-Review

**Spec coverage:**
- ✅ Branch structure (hierarchical AGENTS.md inside codebase) → Tasks 2, 3, 7
- ✅ Correct code patterns (VSA 2-file, not 4-file) → Task 4 coding.md
- ✅ Frontend genericHooks patterns → Task 8 coding.md
- ✅ ✅/❌ examples throughout → Tasks 4, 8
- ✅ Done checklists → Tasks 3, 7 (AGENTS.md files)
- ✅ Gotchas filled → Tasks 5, 9, 11
- ✅ Thin wrapper agents → Task 12
- ✅ CLAUDE.md updated → Task 13
- ✅ Wiki structure preserved → Tasks 10 (project-structure), 11 (gotchas)

**Placeholder check:** No TBD/TODO/placeholder in critical content files. Branch-copied files (project-structure, routing, components, authorization, testing) may contain minor TODOs from the branch — acceptable as they are accurate enough.

**Type consistency:** No code type definitions used across tasks — docs only.
