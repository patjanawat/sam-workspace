# CR#8 — Remove Pricing Team from Approval Flow — Solution & Flow

**Related:** [CR8-impact-analysis.md](./CR8-impact-analysis.md), CR9 (delegate change), CR10 (Pending With Who)
**Date:** 2026-05-26

---

## 1. Change Summary

ตัด **Pricing Team (pte)** ออกจาก approval flow

```
ก่อน (4 ขั้น):  srp → sam → sdm → pte → cdr
หลัง  (3 ขั้น): srp → sam → sdm ───────→ cdr
                              (ข้าม pte)
```

**Constraints (จาก meeting):**
- SAP sync pricing check ยังคงเดิม — ไม่แตะ
- Code pte เก็บไว้ทั้งหมด (enum / constant / seed / user accounts) — รองรับ rollback
- ใช้กับ proposal ทุกประเภท (R/S/P)

---

## 2. Recommended Solution — Feature Flag

ใช้ single config value: **`Flow.UseLegacy = bool`**

| State | Flow |
|---|---|
| `false` (default) | New 3-step flow (no pte) |
| `true` | Legacy 4-step flow (with pte) — rollback |

**Wrap:** flow array + delegate targets + email recipients + step calc

**เหตุผลเลือก flag (option B):**
- Meeting ระบุชัด "เก็บเวอร์ชั่นเก่าไว้"
- Rollback ได้โดยไม่ต้อง redeploy
- Risk ต่ำกว่า hard delete

---

## 3. Implementation Flow (5 Steps)

### STEP 1 — Backend Core Flow

| File | Change |
|---|---|
| `Features/ApprovalHistories/ApprovalProgressQuery/ApprovalProgressQueryHandler.cs:10` | Flow array `[sam(0), sdm(1), pte(2), cdr(3)]` → `[sam(0), sdm(1), cdr(2)]` |
| `Features/Approval/Search/SearchApprovalSql.cs:191-192` | `WHEN ap.RoleCode = 'sdm' THEN 'PT'` → `'CD'`. Remove `WHEN ap.RoleCode = 'pte' THEN 'CD'` |
| `Features/Approval/Search/SearchApprovalSql.cs:271-280` | Remove pte visibility branch |
| `Features/Approval/Search/SearchApprovalSql.cs:285` | CDR visibility: `cdr sees pte/cdr` → `cdr sees sdm/cdr` |

### STEP 2 — Delegation (couples with CR9)

| File | Change |
|---|---|
| `Features/ApprovalSettings/GetAll/GetApprovalSettingsQueryHandler.cs:12` | `DelegateTargetsByRole`: `sdm → pte` → `sdm → cdr` |
| `Features/ApprovalSettings/GetOptions/GetApprovalOptionHandler.cs:9` | `DelegateRoleCodes`: remove `pte` |
| `Features/Approval/Shared/ApprovalService.cs:266` | `AutoApproveBySdmAsync`: target `pte` → `cdr` หรือลบถ้าไม่จำเป็น |

### STEP 3 — Email Notification + Permission

| File | Change |
|---|---|
| `Shared/Helpers/ApproveRejectEmailService.cs:54,157-167` | Remove `pteHistory` lookup + pte notification object |
| `Shared/Helpers/NotificationEmailHelper.cs:27,47-56,157-192` | Remove pte from `NotifyAsync` params, `GetSenderName`, `ResolveRecipientsAsync` chain |
| `Shared/Helpers/UserRoleHelper.cs:33` | `CanApprovalListAction`: remove `PricingTeam` |
| `Features/ApprovalSettings/GetOrgChart/GetApprovalOrgChartHandler.cs:10` | Remove pte from org chart roles |

### STEP 4 — Frontend

| File | Change |
|---|---|
| `features/approval/components/details/DetailStepper.tsx:21` | 4-step `[sam, sdm, pte, cdr]` → 3-step `[sam, sdm, cdr]` |
| `features/approval/constants/approval-roles.ts:6` | `RolesApproval`: remove `"Pricing Team"` |
| `features/approval/constants/approval-roles.ts:10` | `ViewerRole` type: keep `'pte'` (rollback) — remove from active list |
| `app/(protected)/approval/.../pricing-team/` | Hide from navigation — keep code |
| Role-based nav menu | Filter out `pte` link |
| Approval markups / storybook | Update fixtures — skip pte |

### STEP 5 — Migration + Test

**Migration SQL (ก่อน cutover):**
- Pending proposals ค้างที่ pte step → auto-advance ไป cdr **หรือ** queue for manual SDM re-approve
- Audit `UserDelegate` ที่ target pte → cleanup

**Tests:**
- 3-step flow expected
- pte user → 403 / approve ไม่ได้
- sdm approve → next = cdr (ไม่ใช่ pte)
- Email recipients ไม่มี pte
- Regression: SAP sync pricing logic เหมือนเดิม

---

## 4. Files **เก็บไว้** (rollback safety — DO NOT DELETE)

| File / Item | Why |
|---|---|
| `Shared/Enums/UserRole.cs:9,24,37` `UserRole.Pte` | Rollback |
| `Shared/Constants/UserRoleConstants.cs:9` `PricingTeam = "pte"` | Rollback |
| `Database/Seed/SeedRole.cs:17` pte row | DB role row ต้องมี |
| Existing pte user accounts | Active ต่อ — แค่ไม่อยู่ใน flow |
| `ApprovalHistory` rows เก่าที่มี pte | Audit trail intact |
| `UserRoleHelper.cs:16` `GlobalRolesViewAllProposal` (pte) | View access — confirm กับ Art ก่อน |
| `Features/SapSync/*` | SAP pricing check ห้ามแตะ |

---

## 5. Coupled CRs

| CR | Coupling |
|---|---|
| **CR9** | Delegate sdm → cdr (direct) — **must deploy together** |
| **CR10** | "Pending With Who" column — reflect new flow |
| **CR5 mass upload** | Approver sdm → cdr (skip sam) — already matches |

---

## 6. Risks / Blockers

| # | Item | Severity | Mitigation |
|---|---|---|---|
| 1 | Couple กับ CR9 | **H** | Same PR / release window |
| 2 | In-flight pte-pending proposals | **H** | Migration SQL before cutover |
| 3 | pte view access decision | Med | Block — confirm กับ Art |
| 4 | Rollback path | Med | Feature flag (option B) |
| 5 | Email template null guard | Med | Guard pte recipient variable |
| 6 | FE stepper layout (4→3) | Low | Visual spacing review |
| 7 | Historical email reference pte | Low | No rewrite — fine |

---

## 7. Effort Estimate

| Phase | Days |
|---|---|
| BE flow array + feature flag wrapper | 0.5 |
| BE search SQL update | 0.5 |
| BE delegate config + auto-approve | 0.5 |
| BE email notification flow | 0.5 |
| BE role helpers + org chart | 0.3 |
| BE tests + regression | 1.5 |
| BE migration SQL (pending pte proposals) | 0.5 |
| FE stepper + role constants | 0.3 |
| FE nav filter + markups | 0.5 |
| FE tests | 0.5 |
| Coordination with CR9 | 0.3 |
| Code review + QA + UAT | 2.0 |
| **Total** | **~7.9 d** |

---

## 8. Action Items (ลำดับความเร่งด่วน)

1. **[BLOCK]** Confirm กับ Art — pte view access เก็บหรือตัด
2. **[BLOCK]** Coordinate กับ CR9 owner — same release window
3. Audit in-flight pte-pending proposals — สร้าง migration plan
4. Audit existing `UserDelegate` ที่ target pte — cleanup list
5. Verify SAP sync — ห้ามมี pte removal ใน pricing check
6. Implement feature flag wrapper (option B)
7. Guard email template variables (pte = null safe)
8. Update org chart UI
9. Decide deployment order: BE flag off (legacy) → migrate data → toggle flag on (new flow)

---

## 9. Deployment Sequence (Suggested)

```
1. Deploy BE + FE with Flow.UseLegacy = true        (no behavior change)
2. Run migration SQL — advance pte-pending proposals
3. Audit UserDelegate to pte — manual cleanup
4. Toggle Flow.UseLegacy = false                    (cutover)
5. Monitor — ready to toggle back to true if issue
6. After stable period (e.g. 2 sprints) → plan code removal as separate CR
```
