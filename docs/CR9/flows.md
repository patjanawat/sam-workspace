# CR#9 Delegate after PTE Removed — Flows

**Related:** [impact-analysis.md](impact-analysis.md), [solutions.md](solutions.md), [code-changes.md](code-changes.md)

---

## Flow 1 — Pre-Cutover (Current State)

```
┌─────────┐     create proposal      ┌──────────┐
│  SRP    │ ───────────────────────> │ Proposal │
└─────────┘                          │ Draft    │
                                     └────┬─────┘
                                          │ submit
                                          v
                                     ┌──────────┐
                                     │ Pending  │
                                     └────┬─────┘
                                          │
                       ┌──────────────────┼──────────────────┐
                       v                  v                  v
                  ┌─────────┐        ┌─────────┐        ┌─────────┐
                  │  SAM    │ ─────> │  SDM    │ ─────> │  PTE    │ ──> CDR ──> Approved
                  └─────────┘        └────┬────┘        └────┬────┘
                                          │ delegate         │ delegate
                                          v                  v
                                     ┌─────────┐        ┌─────────┐
                                     │  PTE    │        │  (any)  │
                                     │ (target)│        │ allowed │
                                     └─────────┘        └─────────┘
```

---

## Flow 2 — Post-Cutover (CR8 + CR9 Combined)

```
┌─────────┐     create proposal      ┌──────────┐
│  SRP    │ ───────────────────────> │ Proposal │
└─────────┘                          │ Draft    │
                                     └────┬─────┘
                                          │ submit
                                          v
                                     ┌──────────┐
                                     │ Pending  │
                                     └────┬─────┘
                                          │
                       ┌──────────────────┼──────────────────┐
                       v                  v                  v
                  ┌─────────┐        ┌─────────┐        ┌─────────┐
                  │  SAM    │ ─────> │  SDM    │ ─────> │  CDR    │ ──> Approved
                  └─────────┘        └────┬────┘        └─────────┘
                       │ delegate         │ delegate         ▲
                       v                  v                  │
                  ┌─────────┐        ┌─────────┐             │
                  │  SDM    │        │  CDR    │ ────────────┘
                  └─────────┘        └─────────┘

                                                     PTE: removed (CR8)
                                                     CDR delegate: deactivated
```

---

## Flow 3 — Auto-Approve via Full Delegate (SDM all delegated)

```
Pending @ SDM
     │
     v
┌────────────────────────┐
│ IsAllSdmDelegatedAsync │
│  check all SDM →       │
│  delegated to CDR      │
└────────┬───────────────┘
         │ yes
         v
┌────────────────────────┐
│ AutoApproveBySdmAsync  │
│  skip SDM step         │
│  route → CDR           │  (was: → PTE pre-cutover)
└────────┬───────────────┘
         v
    Pending @ CDR
         │ approve
         v
     Approved
         │
         v
     SAP Sync
```

---

## Flow 4 — Migration (Solution B)

```
┌──────────────────────────────────┐
│ Deploy CR8 + CR9 (same release)  │
└────────────────┬─────────────────┘
                 v
┌──────────────────────────────────┐
│ Migration SQL                    │
│  1. SELECT active UserDelegate   │
│     WHERE FromRole=SDM           │
│       AND ToRole=PTE             │
│  2. SET Status = Cancelled       │
│  3. SELECT active UserDelegate   │
│     WHERE FromRole=PTE           │
│  4. SET Status = Cancelled       │
└────────────────┬─────────────────┘
                 v
┌──────────────────────────────────┐
│ Notification job                 │
│  email sdm users w/ cancelled    │
│  delegate → "re-create to CDR"   │
└────────────────┬─────────────────┘
                 v
┌──────────────────────────────────┐
│ sdm user re-creates delegate     │
│  DelegateForm filter shows CDR   │
│  (PTE no longer option)          │
└────────────────┬─────────────────┘
                 v
         New active row:
         SDM → CDR
```

---

## Flow 5 — Validator Guard (Reject Invalid)

```
PUT /approval-settings
{
  fromRole: "sdm",
  targetRole: "pte"   <-- legacy or malicious request
}
     │
     v
┌─────────────────────────────────────┐
│ UpdateApprovalSettingsValidator     │
│  check:                             │
│  targetRole ∈                       │
│    DelegateTargetsByRole[fromRole]  │
│  SDM allowed targets: [CDR]         │
└────────┬────────────────────────────┘
         │ pte ∉ [cdr]
         v
    HTTP 400
    "Invalid delegate target for role sdm"
```

---

## Flow 6 — UI State Pre vs Post

```
Pre-cutover DelegateForm                Post-cutover DelegateForm
─────────────────────────               ──────────────────────────
From: [SDM      v]                      From: [SDM      v]
To:   [PTE      v]   <-- only option    To:   [CDR      v]   <-- only option

From: [PTE      v]   <-- allowed        From: [SDM      v]   <-- PTE removed
To:   [any   v]                              from dropdown

From: [SAM      v]                      From: [SAM      v]
To:   [SDM      v]                      To:   [SDM      v]   (unchanged)
```
