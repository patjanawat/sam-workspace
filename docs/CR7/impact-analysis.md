# CR#7 Show Ex-Work Price (Sale Rep) — Impact Analysis (FE/BE)

**Sources:**
- Meeting: `docs/CR5-review-meeting-summary.md` ข้อ 7
- Codebase: SAM submodule (`web/web/backend/`, `web/web/frontend/`)

**Change summary:** เพิ่ม column **Price Ex-Work per product** ใต้ Change column ใน Summary page (last step ของ Sale Rep create + SAM approval view). Apply Type S + Type P (R already exists at SDM/PT/CD level).
**Formula:** `PriceEXW = PriceList - MaxExRebate - Discount` (Type S = `PriceList - totalCur`; Type P = `PriceList - RATE`)

## Discovery — already done at upper levels

| Level | Type R | Type S | Type P |
|---|---|---|---|
| SAM (Area Sales Manager) | ❌ no priceEXW | ❌ no priceEXW | ❌ no priceEXW |
| SDM / Pricing / CD | ✅ has priceEXW | ✅ has priceEXW (`PRICE_LIST - totalCur`) | ✅ has priceEXW (`PRICE_LIST - RATE`) |
| Sale Rep create — Summary step | ❌ missing | ❌ missing | ❌ missing |

Meeting said "level บนเห็นอยู่แล้ว" — confirmed at SDM/PT/CD. Need **add to Sale Rep create + SAM approval view**.

⚠️ **SSM ≠ existing role.** Codebase has `sam = Area Sales Manager`, no "Sales Section Manager". Confirm with Art: SSM = SAM? Or new role?

## Backend Impact

### Approval SAM handlers (add `priceEXW`)

| File | Change | Severity |
|---|---|---|
| `Features/Approval/Sam/GetById/OverviewDetailTypeS.cs:74-123` | Add `priceEXW = PRICE_LIST - totalCur` calc + return in DTO (mirror Sdm pattern at line 100,120) | **H** |
| `Features/Approval/Sam/GetById/OverViewDetailTypeP.cs:30-44` | Add `priceEXW = PRICE_LIST - RATE` (mirror Sdm pattern at line 38) | **H** |
| `Features/Approval/Sam/GetById/OverviewDetailTypeR.cs` | Verify — likely already has priceEXW (FE column exists in `RB_SAM_TYPE_R` per discovery — need confirm) | M |

### Sale Rep create — Summary read endpoint

| File | Change |
|---|---|
| `Features/Proposal/GetById/GetProposalByIdQueryHandler.cs` | Verify — Summary page likely calls this. Add `priceEXW` per product in proposal product list OR use shared computation helper |
| New shared helper (recommended) | Extract `CalculatePriceExw(priceList, totalDiscount, rate)` to avoid 4-site copy (R/S/P × SAM/SDM/Get) |

### Entity (no schema change)

| Entity | Status |
|---|---|
| `Entities/ProposalProductTypeRS.cs:10,12,29` (PRICE_LIST, SUBSIDY, RATE) | Existing fields — sufficient |
| `Entities/ProposalProductTypeP.cs:10,12,27` | Same |

### Tests

| File | Change |
|---|---|
| `SamApp.WebApi.Tests/Features/Approval/Sam/...TypeS` | Add priceEXW assertion |
| `SamApp.WebApi.Tests/Features/Approval/Sam/...TypeP` | Same |
| `SamApp.WebApi.Tests/Features/Proposal/GetById/...` | Add priceEXW assertion (Sale Rep summary path) |

**BE file count:** 2-3 handlers + 1 shared helper + tests

## Frontend Impact

### Existing types — already support priceEXW

| File | Status |
|---|---|
| `features/approval/types/approval-overview-r.ts:26` `priceEXW: number` | Exists |
| `features/approval/types/approval-overview-s.ts:35` `priceEXW: number` | Exists |
| `features/approval/types/approval-overview-p.ts:24` `priceEXW: number` | Exists |
| `features/approval/mapper/approval.mapper.ts:48,90,133` | Mapper already passes through |

### Add column to SAM approval views

| File | Change | Severity |
|---|---|---|
| `features/approval/constants/rebate-columns.ts:48-64` `RB_SAM_TYPE_R` | Verify — may already include `PriceExw` (R already wired). If missing, add | M |
| `features/approval/constants/rebate-columns.ts:66-83` `RB_SAM_TYPE_S` | **Add** `{ id: PriceExw, header: ... }` (position: ใต้ Change column) | **H** |
| `features/approval/constants/rebate-columns.ts:85-95` `RB_SAM_TYPE_P` | **Add** same | **H** |

### Sale Rep create — Summary page

| File | Change | Severity |
|---|---|---|
| `features/request/components/proposal/summary/type-r/SummaryWrapper.tsx:135-612` (R + S shared) | Add `priceEXW` column per product (Type S only — per meeting). Position: ใต้ Change column | **H** |
| `features/request/components/proposal/summary/type-p/SummaryWrapper.tsx:43-296` | Add `priceEXW` column per product | **H** |
| `features/request/components/proposal/summary/type-p/ViewRebate.tsx:93-593` | If product readonly table separate — add column |
| `app/(protected)/request/[id]/summary/page.tsx:9-10` | No route change — routing already correct |

### Types — Sale Rep summary response

| File | Change |
|---|---|
| `features/request/types/get-proposal-by-id-query-response.ts` | Add `priceEXW: number` per product in products array (Type S + P) |
| `features/request/types/...summary*.ts` | Verify summary-specific types |

### Mapper / Formula on FE (alternative — if BE not adding)

| File | Change |
|---|---|
| `features/request/mapper/summary-rebate.mapper.tsx` | Could compute `priceEXW = priceList - totalDiscount` client-side. **Reject** — BE single-source-of-truth, avoid drift with approval calc |

### i18n

| File | Change |
|---|---|
| `lib/i18n/locales/en.json` / `th.json` | Add label "Price Ex-Work" / "ราคา Ex-Work" |

**FE file count:** ~6 files (3 column constants + 2 summary wrappers + types + i18n)

## Constraints (per meeting)

| Rule | Enforcement |
|---|---|
| Apply Type S + Type P only | FE: column add only in Type S + P summary; Type R already done at upper levels |
| Position: ใต้ Change column | FE: order column array correctly |
| Per product (not aggregate) | Render in product table row, not header |
| Sale Rep + SSM only (level บนมีแล้ว) | SSM=SAM presumed — confirm |

## Risk / Blocker

| Item | Severity | Note |
|---|---|---|
| SSM role identity | **High** | "SSM" not in codebase — clarify with Art: SAM? SDM? new role? |
| Type R parity check at SAM level | Med | Meeting says Type S+P — but verify Type R SAM column too (may be inconsistent today) |
| Formula consistency BE vs existing SDM calc | **High** | Use exact same formula `PRICE_LIST - totalCur` (S) / `PRICE_LIST - RATE` (P) — extract shared helper to prevent drift |
| Summary page also shown to non-Sale-Rep (back navigate) | Low | Confirm Summary page restricted to creator role (likely yes) |
| Sale Rep payload may not include all rebate types (depends on form state) | Med | If FE calculates pre-submit, `totalCur` may differ from final approval calc. Recommend: BE-driven only |

## Effort Estimate

| Phase | Effort |
|---|---|
| BE SAM Type S handler add priceEXW | 0.3 d |
| BE SAM Type P handler add priceEXW | 0.3 d |
| BE Sale Rep GetProposalById add priceEXW + shared helper | 0.5 d |
| BE tests | 0.5 d |
| FE column constants (SAM Type S/P) | 0.3 d |
| FE Sale Rep summary type-r (S branch) | 0.5 d |
| FE Sale Rep summary type-p | 0.5 d |
| FE types + i18n | 0.3 d |
| FE component tests | 0.5 d |
| Code review + QA + UAT | 1.0 d |
| **Total** | **~4.7 d** |

## Action Items

1. **Confirm SSM role** with Art — is it SAM, or new role?
2. Confirm Type R parity — meeting mentioned only S+P, but inconsistent if SAM R already shows it
3. Extract shared `CalculatePriceExw` helper — avoid 4-site formula duplication
4. Verify `RB_SAM_TYPE_R` already has PriceExw column (per discovery hint)
5. Confirm "Change" column position in current summary — column ordering matters
6. i18n wording — confirm with Art (Thai label preference)
7. Audit `priceEXW` consistency across all 4 handlers (R-SAM, R-SDM, S-*, P-*) — fix drift if any
