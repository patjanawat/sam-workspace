# CR#8 — `Flow.UseLegacy` Feature Flag — Full Design

**Status:** Design only — NOT applied to `web/` submodule yet (awaiting confirmation)
**Related:** [CR8-solution-flow.md](./CR8-solution-flow.md)

---

## 1. Config Schema

### `appsettings.json`

```json
{
  "ApprovalFlow": {
    "UseLegacy": false,
    "Comment": "true = 4-step legacy (srp→sam→sdm→pte→cdr). false = 3-step new (srp→sam→sdm→cdr)."
  }
}
```

### Per-environment override

| Environment | UseLegacy | Note |
|---|---|---|
| `appsettings.Development.json` | `true` | safe default while in flight |
| `appsettings.Staging.json` | `false` | validate new flow |
| `appsettings.Production.json` | `true` → `false` after cutover | flip after migration |

---

## 2. Options + DI Registration

### `Infrastructure/Configuration/ApprovalFlowOptions.cs` (new)

```csharp
namespace SamApp.WebApi.Infrastructure.Configuration;

public sealed class ApprovalFlowOptions
{
    public const string SectionName = "ApprovalFlow";

    public bool UseLegacy { get; init; }
}
```

### `Program.cs` registration

```csharp
builder.Services
    .AddOptions<ApprovalFlowOptions>()
    .Bind(builder.Configuration.GetSection(ApprovalFlowOptions.SectionName))
    .ValidateOnStart();

builder.Services.AddSingleton<IApprovalFlowProvider, ApprovalFlowProvider>();
```

---

## 3. Provider — single source of truth

### `Features/Approval/Shared/IApprovalFlowProvider.cs` (new)

```csharp
namespace SamApp.WebApi.Features.Approval.Shared;

public interface IApprovalFlowProvider
{
    /// <summary>Ordered approval steps: (RoleCode, Ordinal).</summary>
    IReadOnlyList<(string Code, int Ord)> Flow { get; }

    /// <summary>Delegate target roles per source role.</summary>
    IReadOnlyDictionary<string, string[]> DelegateTargetsByRole { get; }

    /// <summary>Roles allowed to receive delegation (DelegateRoleCodes).</summary>
    IReadOnlyList<string> DelegateRoleCodes { get; }

    /// <summary>Roles included in email notification chain.</summary>
    IReadOnlyList<string> EmailRecipientRoleChain { get; }

    /// <summary>Roles allowed to act (approve/reject) — for CanApprovalListAction.</summary>
    IReadOnlyList<string> ActionableRoles { get; }

    /// <summary>Roles shown in OrgChart.</summary>
    IReadOnlyList<string> OrgChartRoles { get; }

    /// <summary>Next role after given role in the active flow. Null if last step.</summary>
    string? NextRole(string currentRoleCode);

    /// <summary>Visibility rule — which roles a given role can see in search.</summary>
    IReadOnlyList<string> VisibleRolesFor(string currentRoleCode);

    bool IsLegacy { get; }
}
```

### `Features/Approval/Shared/ApprovalFlowProvider.cs` (new)

```csharp
using Microsoft.Extensions.Options;
using SamApp.WebApi.Infrastructure.Configuration;
using SamApp.WebApi.Shared.Constants;

namespace SamApp.WebApi.Features.Approval.Shared;

public sealed class ApprovalFlowProvider : IApprovalFlowProvider
{
    private readonly ApprovalFlowOptions _options;

    // Legacy 4-step
    private static readonly (string Code, int Ord)[] LegacyFlow =
    [
        (UserRoleConstants.AreaSaleManager, 0),
        (UserRoleConstants.SaleDivisionManager, 1),
        (UserRoleConstants.PricingTeam, 2),
        (UserRoleConstants.CommercialDirector, 3),
    ];

    // New 3-step (CR#8)
    private static readonly (string Code, int Ord)[] NewFlow =
    [
        (UserRoleConstants.AreaSaleManager, 0),
        (UserRoleConstants.SaleDivisionManager, 1),
        (UserRoleConstants.CommercialDirector, 2),
    ];

    private static readonly Dictionary<string, string[]> LegacyDelegateTargets =
        new(StringComparer.OrdinalIgnoreCase)
        {
            [UserRoleConstants.AreaSaleManager]     = [UserRoleConstants.SaleDivisionManager],
            [UserRoleConstants.SaleDivisionManager] = [UserRoleConstants.PricingTeam],
        };

    private static readonly Dictionary<string, string[]> NewDelegateTargets =
        new(StringComparer.OrdinalIgnoreCase)
        {
            [UserRoleConstants.AreaSaleManager]     = [UserRoleConstants.SaleDivisionManager],
            [UserRoleConstants.SaleDivisionManager] = [UserRoleConstants.CommercialDirector],
        };

    public ApprovalFlowProvider(IOptions<ApprovalFlowOptions> options)
    {
        _options = options.Value;
    }

    public bool IsLegacy => _options.UseLegacy;

    public IReadOnlyList<(string Code, int Ord)> Flow =>
        _options.UseLegacy ? LegacyFlow : NewFlow;

    public IReadOnlyDictionary<string, string[]> DelegateTargetsByRole =>
        _options.UseLegacy ? LegacyDelegateTargets : NewDelegateTargets;

    public IReadOnlyList<string> DelegateRoleCodes =>
        _options.UseLegacy
            ? [UserRoleConstants.SaleDivisionManager, UserRoleConstants.PricingTeam]
            : [UserRoleConstants.SaleDivisionManager];

    public IReadOnlyList<string> EmailRecipientRoleChain =>
        Flow.Select(x => x.Code).ToArray();

    public IReadOnlyList<string> ActionableRoles =>
        _options.UseLegacy
            ? [UserRoleConstants.AreaSaleManager,
               UserRoleConstants.SaleDivisionManager,
               UserRoleConstants.PricingTeam,
               UserRoleConstants.CommercialDirector]
            : [UserRoleConstants.AreaSaleManager,
               UserRoleConstants.SaleDivisionManager,
               UserRoleConstants.CommercialDirector];

    public IReadOnlyList<string> OrgChartRoles => ActionableRoles;

    public string? NextRole(string currentRoleCode)
    {
        var flow = Flow;
        for (var i = 0; i < flow.Count - 1; i++)
        {
            if (string.Equals(flow[i].Code, currentRoleCode, StringComparison.OrdinalIgnoreCase))
                return flow[i + 1].Code;
        }
        return null;
    }

    public IReadOnlyList<string> VisibleRolesFor(string currentRoleCode)
    {
        // CDR sees the last two steps (previous approver + self).
        // SDM sees self + next step. SAM sees self only.
        var flow = Flow.Select(x => x.Code).ToList();
        var idx = flow.FindIndex(c =>
            string.Equals(c, currentRoleCode, StringComparison.OrdinalIgnoreCase));

        if (idx < 0) return [];
        var from = Math.Max(0, idx - 1);
        return flow.GetRange(from, idx - from + 1);
    }
}
```

---

## 4. Usage — Replace Hard-Coded Arrays

### A. `ApprovalProgressQueryHandler.cs` — inject provider

```csharp
public record ApprovalProgressQueryHandler : IRequestHandler<ApprovalProgressQueryRequest, ApprovalProgressQueryResponse>
{
    private readonly SamAppDbContext _db;
    private readonly ICurrentUserService _currentUserService;
    private readonly IApprovalFlowProvider _flow;

    public ApprovalProgressQueryHandler(
        SamAppDbContext db,
        ICurrentUserService currentUserService,
        IApprovalFlowProvider flow)
    {
        _db = db;
        _currentUserService = currentUserService;
        _flow = flow;
    }

    public async Task<ApprovalProgressQueryResponse> Handle(...)
    {
        var flow = _flow.Flow;
        var flowCodes = flow.Select(x => x.Code).ToArray();
        var ordByCode = flow.ToDictionary(x => x.Code, x => x.Ord);
        // ...rest unchanged
    }
}
```

### B. `GetApprovalSettingsQueryHandler.cs`

```csharp
public class GetApprovalSettingsQueryHandler(
    SamAppDbContext db,
    ICurrentUserService currentUser,
    IApprovalFlowProvider flow)
    : IRequestHandler<GetApprovalSettingsQuery, GetApprovalSettingsResponse>
{
    public async Task<GetApprovalSettingsResponse> Handle(...)
    {
        var delegateTargets = flow.DelegateTargetsByRole;
        // use delegateTargets instead of static DelegateTargetsByRole
    }
}
```

### C. `GetApprovalOptionHandler.cs`

```csharp
public class GetApprovalOptionHandler(SamAppDbContext db, IApprovalFlowProvider flow)
    : IRequestHandler<GetApprovalOptionQuery, GetApprovalOptionResponse>
{
    public async Task<GetApprovalOptionResponse> Handle(...)
    {
        var delegateRoleCodes = flow.DelegateRoleCodes.ToArray();
        var roleDelegates = await db.Roles
            .Where(u => delegateRoleCodes.Contains(u.Code))
            // ...
    }
}
```

### D. `ApprovalService.cs` — `AutoApproveBySdmAsync`

```csharp
public async Task AutoApproveBySdmAsync(...)
{
    var nextRole = _flow.NextRole(UserRoleConstants.SaleDivisionManager);
    if (nextRole is null) return;

    // search target = nextRole (was hard-coded "pte")
    var nextApprover = await _db.Users
        .FirstOrDefaultAsync(u => u.RoleCode == nextRole && u.IsActive && !u.IsDelete, ct);
    // ...
}
```

### E. `NotificationEmailHelper.cs` — recipient resolver

```csharp
public async Task<List<string>> ResolveRecipientsAsync(
    int proposalId,
    string actionRoleCode,
    CancellationToken ct)
{
    var chain = _flow.EmailRecipientRoleChain;
    var idx = chain.IndexOf(actionRoleCode);
    if (idx < 0) return [];

    var nextRoles = chain.Skip(idx + 1).ToArray();
    // query users by nextRoles instead of hard-coded sam→sdm→pte→cdr
    // ...
}
```

### F. `UserRoleHelper.cs` — `CanApprovalListAction`

```csharp
public static bool CanApprovalListAction(string roleCode, IApprovalFlowProvider flow)
{
    return flow.ActionableRoles.Contains(roleCode, StringComparer.OrdinalIgnoreCase);
}
```

> If static signature must stay, expose flow via constructor injection on caller and pass actionable list down.

### G. `SearchApprovalSql.cs` — dynamic CASE / visibility

```csharp
public class SearchApprovalSql(IApprovalFlowProvider flow)
{
    public string BuildStepCalcCase()
    {
        // Step abbreviation for the role *before* CDR in the active flow.
        // Legacy: sdm → 'PT', pte → 'CD'. New: sdm → 'CD'.
        if (flow.IsLegacy)
        {
            return @"
                CASE
                    WHEN ap.RoleCode = 'sam' THEN 'SM'
                    WHEN ap.RoleCode = 'sdm' THEN 'PT'
                    WHEN ap.RoleCode = 'pte' THEN 'CD'
                    ELSE NULL
                END";
        }
        return @"
            CASE
                WHEN ap.RoleCode = 'sam' THEN 'SM'
                WHEN ap.RoleCode = 'sdm' THEN 'CD'
                ELSE NULL
            END";
    }

    public string BuildVisibilityWhere(string currentRoleCode)
    {
        var visible = flow.VisibleRolesFor(currentRoleCode);
        var quoted = string.Join(", ", visible.Select(r => $"'{r}'"));
        return string.IsNullOrEmpty(quoted)
            ? "1 = 0"
            : $"ap.RoleCode IN ({quoted})";
    }
}
```

### H. `GetApprovalOrgChartHandler.cs`

```csharp
public class GetApprovalOrgChartHandler(SamAppDbContext db, IApprovalFlowProvider flow)
{
    public async Task<GetApprovalOrgChartResponse> Handle(...)
    {
        var roles = flow.OrgChartRoles.ToArray();
        var query = db.Users.Where(u => roles.Contains(u.RoleCode) && u.IsActive);
        // ...
    }
}
```

---

## 5. Frontend Mirror

### `frontend/src/lib/config.ts` (new or extend)

Server endpoint exposes flag → FE caches it.

```ts
// Backend exposes GET /api/config/approval-flow
//   returns { useLegacy: boolean, flow: string[] }

export type ApprovalFlowConfig = {
  useLegacy: boolean;
  flow: ('sam' | 'sdm' | 'pte' | 'cdr')[];
};
```

### `features/approval/components/details/DetailStepper.tsx`

```tsx
const stepLabels: Record<string, string> = {
  sam: 'Area Sale Manager',
  sdm: 'Sale Division Manager',
  pte: 'Pricing Team',
  cdr: 'Commercial Director',
};

export function DetailStepper({ flow }: { flow: string[] }) {
  return (
    <Stepper>
      {flow.map((code, i) => (
        <Step key={code} index={i} label={stepLabels[code]} />
      ))}
    </Stepper>
  );
}
```

`flow` prop comes from server config — no hard-coded array.

### `features/approval/constants/approval-roles.ts`

```ts
export const RolesApproval = ['Area Sale Manager', 'Sale Division Manager', 'Commercial Director'] as const;

// Keep pte in type union for rollback safety
export type ViewerRole = 'sam' | 'sdm' | 'pte' | 'cdr';

export const ActiveViewerRoles: ViewerRole[] = ['sam', 'sdm', 'cdr'];
```

---

## 6. Migration Pattern (Pending pte Proposals)

```sql
-- Run BEFORE flipping UseLegacy = false
-- Auto-advance: any proposal whose latest approval row is at pte (Pending)
--   → mark pte history as Skipped, queue cdr as next pending.

BEGIN TRANSACTION;

DECLARE @PteRoleId UNIQUEIDENTIFIER = (SELECT Id FROM Roles WHERE Code = 'pte');
DECLARE @CdrRoleId UNIQUEIDENTIFIER = (SELECT Id FROM Roles WHERE Code = 'cdr');

-- Mark stuck pte rows as Skipped
UPDATE ah
   SET ah.Action       = 5,  -- ApprovalAction.Skipped
       ah.Comment      = ISNULL(ah.Comment, '') + ' [Auto-skipped by CR8 migration]',
       ah.ActionDateUTC = SYSUTCDATETIME()
  FROM ApprovalHistories ah
 INNER JOIN (
       SELECT ProposalId, MAX(ActionDateUTC) AS Last
         FROM ApprovalHistories
        WHERE Action = 2  -- Pending
        GROUP BY ProposalId
 ) latest ON latest.ProposalId = ah.ProposalId
         AND latest.Last       = ah.ActionDateUTC
 WHERE ah.ApproverRoleId = @PteRoleId
   AND ah.Action         = 2;

-- TODO: insert new Pending row for cdr if business decides auto-advance.
-- Otherwise leave for manual SDM re-approve trigger.

COMMIT;
```

---

## 7. Test Plan

### xUnit (BE)

```csharp
public class ApprovalFlowProviderTests
{
    [Fact]
    public void New_flow_excludes_pte()
    {
        var opts = Options.Create(new ApprovalFlowOptions { UseLegacy = false });
        var sut  = new ApprovalFlowProvider(opts);

        sut.Flow.Select(x => x.Code).Should().Equal("sam", "sdm", "cdr");
        sut.NextRole("sdm").Should().Be("cdr");
        sut.DelegateTargetsByRole["sdm"].Should().Equal("cdr");
        sut.ActionableRoles.Should().NotContain("pte");
    }

    [Fact]
    public void Legacy_flow_preserved_when_flag_on()
    {
        var opts = Options.Create(new ApprovalFlowOptions { UseLegacy = true });
        var sut  = new ApprovalFlowProvider(opts);

        sut.Flow.Select(x => x.Code).Should().Equal("sam", "sdm", "pte", "cdr");
        sut.NextRole("sdm").Should().Be("pte");
    }
}
```

### Regression

- SAP sync still calls pricing service when `UseLegacy=false`
- pte user login → cannot approve (403) when `UseLegacy=false`
- pte user still listed in `Roles` table (seed unchanged)

---

## 8. Cutover Runbook

```
1. Merge PR (BE + FE) — flag default = true in prod
2. Deploy — verify legacy flow still works
3. Run migration SQL on staging — verify
4. Schedule prod maintenance window
5. Run prod migration SQL — advance pte-pending proposals
6. Toggle UseLegacy = false (config update, no redeploy if using IOptionsMonitor)
7. Smoke test: srp creates proposal → sam approves → sdm approves → cdr sees it
8. Monitor 24h — rollback by flipping flag back to true if needed
9. After 2 sprints stable → remove legacy branch in separate CR
```

> **Note:** For runtime toggle without restart, swap `IOptions<T>` → `IOptionsMonitor<T>` in the provider. Default `IOptions` snapshots at startup.
