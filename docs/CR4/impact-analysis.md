# CR#4 Special Accumulate Rate (THB/Ton) — Impact Analysis (FE/BE)

**Sources:**
- Meeting: `docs/CR5-review-meeting-summary.md` ข้อ 4
- Transcript: `docs/[ACCxManao] CR5 Package - Review and Discussion.docx` (24:26–34:00)
- Codebase: SAM submodule (`web/web/backend/`, `web/web/frontend/`)

**Change summary:** เพิ่ม block ใหม่ **Special Accumulate THB/Ton** (code `AR3`) ขนานกับ Accumulate THB/Ton เดิม (AR1) — **Type S only**, คำนวณ Max-Max เหมือน AR1, รวมใน Total Rebate / Pre-rebate, historical 2026 ก่อนหน้า = blank (no backfill)

## Backend Impact

### Rate type constants + JSON enum

| File | Change | Severity |
|---|---|---|
| `Shared/Constants/RateType.cs:10,23` | Add `SpecialAccumulateThbTon = "AR3"` (code) + `"Special Accumulate Thb/Ton"` (name) | M |
| `Shared/JSON/Enum/SectionKind.cs:9` | Add enum value `SpecialAccumulateThbt` | L |
| `Shared/JSON/Converters/SectionKindConverter.cs:18,35` | Add read `"specialaccumulatethbt"` + write `"specialAccumulateTHBT"` | L |

### Create command + Type S handler

| File | Change |
|---|---|
| `Features/ProposalDetails/CreateCommand/CreateProposalDetailCommandHandler.cs:96-108` | Add switch case `SectionKind.SpecialAccumulateThbt => RateTypeCode.SpecialAccumulateThbTon` |
| `Features/ProposalDetails/CreateCommand/CreateProposalProductTypeS.cs:8-104` | Read new `specAccumPayload` block + `GetAmountFlatAsync(..., SectionKind.SpecialAccumulateThbt)` mirroring AR1 path |
| Type R / Type P create handlers | **No change** — verify validator rejects AR3 section if sent on R/P |

→ Persist via existing `ProposalProductTypeRS` table — `RATE_TYPE` is nvarchar, accepts AR3 **no schema migration needed**

### SAP sync mapping

| File | Change |
|---|---|
| `Shared/SAP/SapGenerateService.cs:440-461` | Add `WHEN N'AR3' THEN N'Z951'` (BOART) + `WHEN N'AR3' THEN N'ZB52'` (KSCHL) — **Q to SAP team: reuse ZB52 or assign new ZB5x?** |

### Approval Summary (SAM + SDM only — BE limited to 2 roles)

| File | Change |
|---|---|
| `Features/Approval/Sam/GetById/OverviewDetailTypeS.cs:59,91,109,200` | Add `SpecialAccumulateThbTon_cur` aggregate + include in `totalRebateCur` + add `SpecialAccumulate` field to `OverviewDetailTypeSDto` + `SpecialAccumulateThbTon_prev` to `TypeSRawRowPrevious` + `GetDataTypeSPreviousAsync` |
| `Features/Approval/Sdm/GetById/OverviewDetailTypeS.cs` | Mirror SAM changes |

→ Other roles (CDR/PTE/FIN/ADT/SLA/ADM) — folder absent in `Features/Approval/`. **Q to BE: render path?** likely shared via SAM/SDM endpoint per role middleware — verify before estimate

### Forcal insert + Report

| File | Change |
|---|---|
| `Features/Approval/Shared/InsertProposalForCalSQL.cs:86-117` | **No change** — `rs.RATE_TYPE AS drtype` generic; AR3 flows automatic (excludes Discount only) |
| `Features/Report/ProposalTracking/ProposalTrackingHandler.cs:147-172,382` | Add `RateTypeCode.SpecialAccumulateThbTon => RateTypeName.SpecialAccumulateThbTon` in `GetRateTypeName`. `RateTHBPerT` column auto-carries AR3 |

### Stored procs (Nott owns — files in SAM repo)

| Step | Owner |
|---|---|
| 1. Add `if @drtype = 'AR3'` branches in `Sql/PamDB/Store-view/sp_sel_ar_dw.sql` (9 sites) mirroring AR1 | Nott |
| 2. Same in `sp_sel_rebate_monthend.sql` (3 sites) + `sp_sel_daily_estimate_rebate.sql` (3 sites) | Nott |
| 3. Coordinate release window with Manao — BE + SP deploy same day | Both |

→ AR3 row written to `Proposal_for_cal` before SP supports it → forecast incomplete / SP throws. **Single release window mandatory**

### Tests

| File | Change |
|---|---|
| `SamApp.WebApi.Tests/Features/ProposalDetails/CreateCommand/...` | Type S create with AR3 block persists `RATE_TYPE = "AR3"` |
| `SamApp.WebApi.Tests/Features/Approval/Sam/...` + `Sdm/...` | Summary returns `SpecialAccumulate` + included in `TotalDiscountAndRebate` |
| Regression | Type R/P create rejects AR3 payload; SAP sync row → `BOART=Z951, KSCHL=ZB52` |

**BE file count:** ~8 files + 3 stored procs (Nott) + tests

## Frontend Impact

### Types / Schema

| File | Change |
|---|---|
| `features/request/types/rebate.types.ts:113` | Add `SpecialAccumulateTHBT = 'specialAccumulateTHBT'` enum |
| `features/approval/types/approval-overview-s.ts:14,34` | Add `specialAccumulate: number` |
| `features/request/schema/...` (Type S create schema) | Add `specialAccumulateTHBT` to allowed sections |

### Mapper

| File | Change |
|---|---|
| `features/request/mapper/summary-rebate.mapper.tsx:17-27` | Add `'specialAccumulateTHBT'` to `RawSection.section` union |
| `features/request/mapper/summary-rebate.mapper.tsx:40-50` | Add `specialAccumulateTHBT: 'specialAccumulateTHBT'` to `SECTION_KEY_MAP` |
| `features/request/mapper/summary-rebate.mapper.tsx:52-62` | Add prefix entry — use `'spacc'` (avoid clash with existing `'sathb'`) |

### Input page + Component

| File | Change |
|---|---|
| `features/request/components/proposal/special-accumulate/SpecialAccumulateWrapper.tsx` (NEW) | Sibling of `accumulate-amount/AccumulateWrapper.tsx`. Unit: **THB/Ton** (not Amount). Copy: `info="เงินคืนสะสมพิเศษ (บาท/ตัน)"`, `title="Special Accumulate THB/Ton"` |
| `app/(protected)/request/[id]/special-accumulate/page.tsx` (NEW) | Route page mounting wrapper |
| Type S step navigation config | Insert new step between Accumulate Amount และ Summary |
| `components/accumulate/AccumulateAmount.tsx:54` | Reuse — verify unit prop or fork if hardcoded "Amount" |

### Display — Summary page

| File | Change |
|---|---|
| `features/request/components/proposal/summary/` (Type S file) | Add Special Accumulate column/row; include in Total Rebate sum + VS Previous calc |
| `features/request/components/proposal/summary/type-r/` + `type-p/` | **No change** |

### Display — Approval views

| File | Change |
|---|---|
| `features/approval/components/details/type-s/` | **Folder absent — investigate render path before code (likely shares type-r/ or generic)** |
| `features/approval/components/details/type-r/` + `type-p/` | **No change** |

### Export (Portfolio Excel — top report / sumtracking)

| File | Change |
|---|---|
| Portfolio Excel handler (locate) | Verify `RateTHBPerT` column carries AR3 row OR add dedicated "Special Accumulate" column — **Q to Art** |

### i18n

| File | Change |
|---|---|
| `lib/i18n/locales/en.json` / `th.json` | Add label "Special Accumulate THB/Ton" / "เงินคืนสะสมพิเศษ (บาท/ตัน)" |

**FE file count:** ~10 files (enum, mapper, 2 types, schema, new wrapper, new route, step nav, Type S summary, Type S approval detail, i18n)

## Constraints (per meeting)

| Rule | Enforcement |
|---|---|
| AR3 = Type S only | BE validator reject AR3 on Type R/P create payload |
| Same Max-Max concept as AR1 | SP `sp_sel_ar_dw.sql` mirror AR1 branch (Nott) |
| Historical 2026 ก่อนหน้า = blank | No backfill SQL. Mapper tolerates absent section (renders empty, not "0") |
| Include in Total Rebate / Pre-rebate | Summary handler aggregate + sum (SAM + SDM) |
| Unit = THB/Ton (not Amount) | Component reuse `AccumulateAmount.tsx` but unit prop = "THB/Ton" |

## Risk / Blocker

| Item | Severity | Note |
|---|---|---|
| SAP KSCHL=ZB52 reuse — may merge/reject duplicate condition type | **High** | Q to SAP team: reuse vs new ZB5x for AR3 |
| SP (Nott) + BE (Manao) release timing | **High** | AR3 row without SP support → forcal incomplete. Single release window |
| Sam + Sdm summary drift | **High** | Both files must change same PR — add test guard |
| Upper-level approval handlers (CDR/PTE/FIN/ADT) absent in BE | **High** | Map render path — block before estimate |
| FE `features/approval/components/details/type-s/` folder absent | **High** | Render path unknown — investigate |
| Historical blank rendering | Med | Mapper must tolerate undefined section, render empty cell |
| Type R/P regression — AR3 leak via shared schema | Med | Validator guard |
| Portfolio Excel column structure | Med | Q to Art: reuse `RateTHBPerT` or new column |
| `RANGE_PREFIX` clash `'sathb'` vs new | Low | Use `'spacc'` |

## Effort Estimate

| Phase | Effort |
|---|---|
| BE constants + enum + converter | 0.3 d |
| BE create handler + Type S read AR3 payload | 0.5 d |
| BE SAP mapping (BOART/KSCHL) | 0.2 d |
| BE Approval SAM + SDM summary (mirror AR1) | 0.8 d |
| BE Report tracking name mapping | 0.2 d |
| BE tests + regression | 0.75 d |
| FE types + schema + mapper | 0.5 d |
| FE new input wrapper + route + step nav | 0.8 d |
| FE Type S summary + approval detail | 1.0 d |
| FE i18n + Portfolio Excel verify | 0.2 d |
| FE tests | 0.5 d |
| Integration (Type S w/ AR3 → forcal → SAP sync) | 1.0 d |
| SAP team sync (KSCHL confirm) | 0.5 d |
| Code review + QA + UAT | 1.5 d |
| **Total** | **~8.75 d** (excl. Nott SP work) |

## Action Items

1. **Block:** SAP team confirm KSCHL/BOART for AR3 (reuse ZB52 vs new ZB5x)
2. **Block:** Map upper-level approval handlers (CDR/PTE/FIN/ADT) — BE render path
3. **Block:** Investigate `features/approval/components/details/type-s/` — FE render path
4. Confirm Portfolio Excel column with Art (`RateTHBPerT` reuse vs new column)
5. Coordinate release window with Nott — SP + BE same day
6. Add unit test: Type R/P create rejects AR3 payload
7. Add unit test: Total Rebate sum includes AR3 in both SAM + SDM
8. Pick non-clashing `RANGE_PREFIX` key (`'spacc'`)
9. Confirm i18n label "เงินคืนสะสมพิเศษ (บาท/ตัน)" with Art
10. Communicate forecast SP impact (daily estimate magnitude shift once AR3 active) to ACC ops
