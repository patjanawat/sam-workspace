# CR#9 Delegate after PTE Removed — Code Changes

**Related:** [impact-analysis.md](impact-analysis.md), [solutions.md](solutions.md), [flows.md](flows.md)

---

## BE Changes — 5 Steps

### Step 1 — Mapping swap

**File:** `web/web/backend/SamApp.WebApi/Features/ApprovalSettings/GetAll/GetApprovalSettingsQueryHandler.cs:9-12`

```csharp
// BEFORE
DelegateTargetsByRole = {
  { "sdm", new[] { "pte" } },
  { "sam", new[] { "sdm" } },
}

// AFTER
DelegateTargetsByRole = {
  { "sdm", new[] { "cdr" } },   // changed pte to cdr
  { "sam", new[] { "sdm" } },   // unchanged
}
```

---

### Step 2 — Drop PTE from delegator list

**File:** `web/web/backend/SamApp.WebApi/Features/ApprovalSettings/GetOptions/GetApprovalOptionHandler.cs:9`

```csharp
// BEFORE
DelegateRoleCodes = new[] { "sdm", "pte" };

// AFTER
DelegateRoleCodes = new[] { "sdm" };
// CDR intentionally excluded — see CR9 (deactivated)
```

---

### Step 3 — Auto-approve re-route

**File:** `web/web/backend/SamApp.WebApi/Features/Approval/Shared/ApprovalService.cs:58,237,262-267`

```csharp
// Methods affected:
//   AutoApproveBySdmAsync
//   IsAllSdmDelegatedAsync
//
// BEFORE: route auto-approve target → "pte"
// AFTER:  route auto-approve target → "cdr"
```

---

### Step 4 — Validator guard

**File:** `web/web/backend/SamApp.WebApi/Features/ApprovalSettings/Update/UpdateApprovalSettingsValidator.cs` *(create if missing)*

```csharp
RuleFor(x => x.TargetRole)
  .Must((dto, target) =>
      DelegateTargetsByRole[dto.FromRole].Contains(target))
  .WithMessage("Invalid delegate target for role {PropertyValue}");
```

---

### Step 5 — Migration SQL

**File:** `web/web/backend/SamApp.WebApi/Migrations/{timestamp}_CR9_DelegateMigration.cs` *(new)*

```sql
-- Cancel SDM → PTE active rows
UPDATE UserDelegate
SET Status = 'Cancelled', UpdatedAt = GETUTCDATE()
WHERE FromRole = 'sdm' AND ToRole = 'pte' AND Status = 'Active';

-- Cancel PTE → * active rows (PTE no longer delegator)
UPDATE UserDelegate
SET Status = 'Cancelled', UpdatedAt = GETUTCDATE()
WHERE FromRole = 'pte' AND Status = 'Active';
```

---

## BE Tests — 5 Cases

**Folder:** `web/web/backend/SamApp.WebApi.Tests/Features/ApprovalSettings/`

| Test | Expected |
|---|---|
| `SdmDelegate_TargetCdr_Success` | 200 OK |
| `SdmDelegate_TargetPte_Returns400` | 400 reject |
| `PteAsDelegator_Returns400` | 400 reject |
| `SdmAllDelegated_AutoApproveTo_Cdr` | proposal routes → CDR |
| `SamDelegate_TargetSdm_Unchanged` | regression pass |

---

## FE Changes — 3 Steps

### Step 1 — DelegateForm filter

**File:** `web/web/frontend/src/features/settings/approval/components/details/DelegateForm.tsx:29,52,55-58`

```tsx
// BEFORE
const filteredManagers = managers.filter(m => {
  if (fromRole === 'sdm') return m.role === 'pte';
  if (fromRole === 'pte') return true;
  return m.role === 'sdm';
});

// AFTER
const filteredManagers = managers.filter(m => {
  if (fromRole === 'sdm') return m.role === 'cdr';   // pte → cdr
  // PTE branch removed — no longer a delegator
  return m.role === 'sdm';
});
```

---

### Step 2 — Verify EditDelegateButton hide for PTE

**File:** `web/web/frontend/src/features/settings/approval/components/EditDelegateButton.tsx:13`

```tsx
// Verify role guard — PTE should NOT see edit button
const canDelegate = ['sdm', 'sam'].includes(currentUserRole);
// CDR excluded — deactivated
```

---

### Step 3 — DelegateDialog props pass-through

**File:** `web/web/frontend/src/features/settings/approval/components/details/DelegateDialog.tsx:39`

```tsx
// Verify props pass-through to updated DelegateForm
// No code change unless prop signature drift
```

---

## FE Tests + Fixtures — 3 Items

| Item | Action |
|---|---|
| MSW handler `GET /approval-settings` | mock returns `sdm → [cdr]` |
| Storybook `DelegateForm.stories.tsx` | update fixture: SDM → CDR |
| Playwright `delegate.spec.ts` | update SDM delegate happy path |

---

## Execution Order

```
1. Create branch: feature/SAM-XXX-cr9-delegate-pte-removal
2. BE Step 1-2 (mapping + delegator list)        ─┐
3. BE Step 3   (auto-approve)                     │ commit 1: mapping
4. BE Step 4   (validator)                       ─┘
5. BE Step 5   (migration SQL)                    commit 2: migration
6. BE tests update + new                          commit 3: tests
7. FE Step 1-3 (form + button + dialog)           commit 4: ui
8. FE fixtures + e2e                              commit 5: tests/fixtures
9. Run BE + FE full suite locally
10. Bundle PR with CR8
```

---

## Touched File Summary

**Backend:**
- 3 source files + 1 validator + 1 migration
- Test suite update + 5 new test cases

**Frontend:**
- 1 source file (+2 verify-only)
- 1 MSW handler + 1 storybook + 1 e2e spec
