# SAM — Code Conventions

Source of truth for code patterns and anti-patterns. If any agent prompt conflicts with this file, this file wins.

---

## Backend — Architecture

### Vertical Slice — 2 files per operation

```
Features/Proposal/Create/
  CreateProposalEndpoint.cs    ← Carter ICarterModule: route, validation, auth policy
  CreateProposalHandler.cs     ← MediatR IRequestHandler: business logic + DB
```

No service layer between Endpoint and Handler.

### Endpoint Pattern (Carter)

```csharp
public class {UseCase}Endpoints : ICarterModule
{
    public void AddRoutes(IEndpointRouteBuilder app)
    {
        app.MapPost("/{route}", async (IMediator mediator, {UseCase}Command command) =>
        {
            var result = await mediator.Send(command);
            return result.Succeeded
                ? Results.Ok(new {UseCase}Response("Success"))
                : Results.BadRequest(new { error = result.Message });
        })
        .WithTags("{Feature}")
        .WithSummary("")
        .Produces<{UseCase}Response>(StatusCodes.Status200OK)
        .RequireAuthorization();
    }
}
```

### Handler + Contracts Pattern

```csharp
public class {UseCase}CommandHandler(SamAppDbContext db, ICurrentUserService user)
    : IRequestHandler<{UseCase}Command, {UseCase}Result>
{
    public async Task<{UseCase}Result> Handle({UseCase}Command request, CancellationToken ct)
    {
        // implementation
        return {UseCase}Result.Success();
    }
}

public record {UseCase}Command(...) : IRequest<{UseCase}Result>;

public record {UseCase}Result(bool Succeeded, string? Message = null)
{
    public static {UseCase}Result Success() => new(true, "Done");
    public static {UseCase}Result Fail(string? msg = null) => new(false, msg ?? "Failed");
}
```

---

## Backend — DB Access

### EF Core vs Dapper

- EF Core: standard CRUD, transactions
- Dapper: complex multi-result queries, raw SQL performance
- ADO.NET: stored procs with OUTPUT parameters (Rebate only)

### Multi-step operations → transaction

```csharp
await using var tx = await db.Database.BeginTransactionAsync(ct);
// ... operations ...
await tx.CommitAsync(ct);
```

### Two DbContexts — never mix

```csharp
// Application data
public class {UseCase}Handler(SamAppDbContext db, ...) { }

// SAP staging tables — separate injection
public class {UseCase}Handler(SAPDbContext sapDb, ...) { }
```

### RowVersion — hex string (not byte[])

```csharp
// Sending to FE
Convert.ToHexString(entity.RowVersion)

// Receiving from FE
Convert.FromHexString(request.RowVersion)
```

---

## Backend — Rules

- Use `async/await` everywhere — never `.Result` or `.Wait()`
- Always pass `CancellationToken ct` through all async methods
- Use `DateTime.UtcNow` — never `DateTime.Now`
- Always set audit fields: `CreatedDateUTC`, `CreatedBy`, `UpdatedDateUTC`, `UpdatedBy`
- Throw `ApiValidationException` for business rule violations (not generic exceptions)
- Use `IHttpContextAccessor` to get current user from claims (`ClaimTypes.NameIdentifier`)
- Add `.RequireAuthorization()` to all routes — specify policy if restricted
- Use Mapster for mapping: `entity.Adapt<ResponseDto>()` — never manual property assignment

---

## Backend — Business Logic Traps

### Proposal lifecycle
- Starts as **Temp (0)**, not Draft (1). FE should not assume a Proposal persists until it becomes Draft.
- Temp proposals are auto-deleted by Hangfire — don't reference Temp IDs after delay.
- CloseMonth blocks `submit` — check before attempting.

### Approval chain
- **ASM auto-bypass**: if submitter is `sam` (ASM), their own approval step is auto-approved immediately.
- **SDM auto-delegate**: if SAM approves and ALL SDM users have active delegation today, SDM step is auto-approved.
- **Approval optimistic lock gate uses status = 10**: raw SQL sets `ProposalStatus = 10` as in-progress sentinel.

### Role-based SQL visibility — not C# guards

| Role | Sees |
|---|---|
| `srp` | Own proposals only |
| `sam` | Own + subordinates (via `ReportToId`) |
| Higher roles | All proposals |

Logic is SQL `@RoleCode`/`@Step` params.

### Bangkok timezone (UTC+7)

Used for: CustomerGroup status, UserDelegate status (midnight run), Proposal year/month validation.

### CDR approval async

CDR approval is **always async** even for single item. Endpoint returns `jobId`. FE must poll via SSE `GET /jobs/{jobId}/events`.

---

## Backend — SAP Integration

### SAP success indicators differ by flow

| Flow | Success indicator |
|---|---|
| Create Discount (Type R) | `"0"` |
| Create Contract (Type P) | `"C"` |
| Change Contract (Type S) | `"S"` |

Never assume same value across flows.

### `Features/Sync/` ≠ `Features/SapSync/`

- `Features/SapSync/` — sends Proposal data to **SAP ERP**
- `Features/Sync/SamSyncJob` (hourly) + `SamMonthlySyncJob` (days 1–5) — syncs **master data from data warehouse**. Unrelated to SAP ERP.

---

## Backend — Rebate Traps

- **Agreement success**: `returnValue == 0`
- **Accrued Sum success**: `returnValue > 0` (opposite logic — don't assume one applies to both)
- ADO.NET required for `sp_sel_rebate_monthend` — EF Core cannot handle OUTPUT params from stored procs.
- `ExportAccruedSum` filter: `fiperiod > period` — exports data *after* the selected period. Intentional.
- `ProposalRebate` ≠ Month-end Rebate: `RebatePayload`/`AccumPayload`/`SpecialPayload` are JSON strings set by Sale Rep — NOT related to month-end calculation.

---

## Backend — CustomerGroup Traps

- Type P: max 1 customer — sending >1 throws `ApiValidationException` (400).
- CustomerGroup **code is immutable** after create.
- Code generation has retry loop (max 5) — race condition protection.
- CustomerGroup Update: dates only — cannot change customers/products after create.

---

## Backend — User & Roles

- One role per user at all times — Update removes all current roles before adding new one.
- `RoleCode` is denormalized: stored in both `UserRoles` join table (source of truth) AND `ApplicationUser.RoleCode`.
- Do NOT set `UserDelegate.Status` manually — owned by `UserDelegateStatusUpdateJob` (runs midnight UTC+7 + app startup).

---

## Frontend — API Hooks

### Always use genericHooks — never raw fetch

```typescript
import { useGet, useGetById, useList, usePost, usePatch, useDelete } from '@/lib/genericHooks';
```

### Mutations — always `{ body: data }`

```typescript
// ✅ Correct
await create({ body: payload });
await update({ body: partialPayload });

// ❌ Wrong — will fail
await create(payload);
```

### Lists — always keepPreviousData

```typescript
export const useGetProposals = (params?: ProposalSearchParams) =>
  useList<ProposalListResponse>(API_BASE, params, {
    staleTime: 0,
    placeholderData: keepPreviousData,
  });
```

---

## Frontend — Form Patterns

### useWatch only — never watch()

```typescript
// ✅ Correct — re-renders only this component
const value = useWatch({ control, name: 'field' });

// ❌ Wrong — re-renders parent on every keystroke
const value = watch('field');
```

### BE errors → form fields

```typescript
const { apply } = useServerErrorsConfigured(form);

try {
  await create({ body: data });
} catch (error) {
  apply(error); // maps BE validation errors to form field errors
}
```

### RowVersion must pass through

If form fetches data with RowVersion, include it in update request payload unchanged.

---

## Frontend — Page Pattern

Every page in `app/(protected)/` uses dynamic() + Suspense:

```tsx
const FeatureWrapper = dynamic(() => import('@/features/{feature}/components/{Feature}Wrapper'));

export default function Page() {
  return (
    <Suspense fallback={<Loading isLoading={true} />}>
      <FeatureWrapper />
    </Suspense>
  );
}
```

---

## Frontend — Role-Based UI

- `sla` role only: Create/Edit Customer Relations
- `adt` role: can only export rebate — cannot trigger calculations or close month
- Role permissions + default landing pages: `src/shared/constants/permissions.ts`
- `assertRoleOr403`: client-side UX guard only — not a security control

---

## Frontend — Anti-Patterns

- Raw `fetch` or `apiRequest` in components — use genericHooks
- `mutate(data)` without `{ body: data }` wrapper
- `watch('field')` instead of `useWatch({ control, name: 'field' })`
- `alert()` for notifications — use `toast.success()` / `toast.error()` from sonner
- Inline styles — Tailwind classes only
- `new Date().toLocaleDateString()` — use dayjs
- Import Radix UI primitives directly — use `@/components/ui/` wrappers
- `any` type without comment explaining why
- Error messages in English — use Thai
- SSE polling via `setInterval` — use `EventSource` + `listenToJobEvents()`
