# CR#1 Net Freight per Customer — Impact Analysis (FE/BE)

**Sources:**
- Spec: `docs/CR1/net-freight.md`
- Meeting: `docs/[ACCxManao] CR5 Package - Review and Discussion.docx` (2026-05-22)
- Codebase scan: SAM submodule (`web/web/backend/`, `web/web/frontend/`)

**Change summary:** เปลี่ยน Net Freight lookup key จาก `Period+Org+Product` → `Period+Org+Customer+Product` (4-part composite)

**Key / Grain (canonical — อ้างชื่อนี้ทุกที่):** `PERIOD + ORGNO + CUSTOMER_CODE + PRODUCT_CODE`
`ORGNO` = SO2 = SalesOrg (param `@SaleOrgCode`) · `CUSTOMER_CODE` = Sold-to (`@SoldtoCode`, match `Customer.SoldtoCode`) · ⚠️ Sold-to vs SAP `KUNNR` ยัง open (Q2)

## Decisions (supersedes spec §)

มติ meeting 2026-05-22 — แต่ละข้อ override section ใน `net-freight.md`:

| Decision | Supersedes (net-freight.md §) | Status |
|---|---|---|
| Match 0 row → `SUBSIDY = 0` | §9 step 5, R5, §17 Q5 | ✅ applied |
| Match >1 row → **error (block create)** | §9 step 5, R5, §16 AC-BE-4 | ✅ applied |
| **No wildcard `'*'` fallback** | §9 step 5, §11 rollback, §12 monitoring, §15 metric | ✅ applied |
| Lookup เดิม `TOP(1) ORDER BY PERIOD DESC` ต้องลบ + count guard | §9 step 4-5, §14.1 query rewrite | ✅ applied |
| Sustaina group ต้อง 1:1 customer (validation guard FE+BE) | §8 R9 (new), §16 AC-BE-9/AC-FE-6, §14 estimate | ✅ applied |
| Nott DW view เสร็จแล้ว → BE −2d (offset ด้วย scope ใหม่) | §14 estimate | ✅ applied |

## Meeting Delta vs Existing CR1 Spec

| Item | Spec doc | Meeting confirm |
|---|---|---|
| Source view | TBD - K.North create | **Done** — Nott build view ใหม่แล้ว store no-impact (just swap view ref) |
| Customer key | `SoldtoCode` | **SO2 + Sold-to + Product + Period** (SO2 = SalesOrg) |
| Match 0 row | Q5 open (wildcard/zero/fail?) | **= 0** (decided) |
| Match >1 row | not in spec | **= error** (new constraint) |
| Sustaina group | not in spec | Must be **1:1 customer** — UI/validation guard |
| Test impact | not flagged | QA test case มี customer >1 จะ fail by design |

## Backend Impact

### Schema / Data layer

| File | Change | Severity |
|---|---|---|
| `Entities/Subsidy.cs:3,10` | Add `CUSTOMER_CODE` field | M |
| `Database/SamAppDbContext.cs:292,302,892` | Update entity config + PK | M |
| New EF migration `AddCustomerToSubsidy` | Add column + 4-part PK + index `IX_Subsidy_Key(Period,Org,Customer,Product)` | M |
| `Sql/PamDB/Store-view/sp_Sync_warehouse.sql:794-920` | `sp_Sync_Subsidy` — repoint to new view, add Customer in SELECT/MERGE/hash | **H** |
| `Sql/PamDB/Seed-init/subsidy.sql:1-155` | Reseed 155 rows with customer dimension | M |

### Sync

| File | Change |
|---|---|
| `Features/Sync/SamSyncService.cs:26` | Unchanged (still call SP) — verify only |

### Proposal Create (Type R + S + P queries)

| File | Change |
|---|---|
| `Features/ProposalDetails/CreateCommand/CreateProposalProductRebateAmount.cs:13,21,30,50,53` | `OUTER APPLY` add `s2.CUSTOMER_CODE = @SoldtoCode`, fallback 0 if 0-match, error if >1 |
| `Features/ProposalDetails/CreateCommand/CreateProposalProductProject.cs:25,34,54,57` | Same |
| `Features/ProposalDetails/CreateCommand/CreateProposalProductDiscountRebate.cs:24,33,53,56` | Same |
| `Features/ProposalDetails/CreateCommand/CreateProposalDetailCommandHandler.cs:101,120` | Pass `@SoldtoCode` from proposal context |

### Volume calc (verify only — uses FR1 type, no Customer needed)

| File | Status |
|---|---|
| `Sql/PamDB/Store-view/sp_get_vol.sql:76,121,161,206,280,325` | Verify FR1 logic still valid |
| `Sql/PamDB/Store-view/sp_get_vol_by_date.sql:61,107` | Same |

### Approval read views (snapshot — unchanged in storage, verify display)

| File | Type | Status |
|---|---|---|
| `Features/Approval/Sam/GetById/OverviewDetailTypeR.cs` | R-SAM | Snapshot read — no code change |
| `Features/Approval/Sdm/GetById/OverviewDetailTypeR.cs` | R-SDM | Same |
| `Features/Approval/Sam/GetById/OverviewDetailTypeS.cs` | S-SAM | Same |
| `Features/Approval/Sdm/GetById/OverviewDetailTypeS.cs` | S-SDM | Same |
| `Features/Approval/Sam/GetById/OverViewDetailTypeP.cs` | P-SAM | Same |
| `Features/Approval/Sdm/GetById/OverviewDetailTypeP.cs` | P-SDM | Same |

### Reporting

| File | Status |
|---|---|
| `Features/Report/ProposalTracking/ProposalTrackingHandler.cs:389` | Snapshot — no change |

### Tests

| File | Change |
|---|---|
| `SamApp.WebApi.Tests/...Entities/SubsidyTests` | Update for new field |
| New unit test | `sp_Sync_Subsidy` 4-part MERGE |
| New unit test | Lookup exact + 0-match=0 + >1=error policies |

**BE file count:** ~8 files changed + ~6 verify-only (approval reads, vol SPs) + 1 migration + tests (= ~11 touch points, ตรงกับ net-freight.md §7.2)

## Frontend Impact

### Types / DTO (sync with BE field name)

| File | Change |
|---|---|
| `features/approval/types/rebate-info.types.ts:16,17` | Verify `freightSubsidy` / `freightRebate` numeric |
| `features/approval/types/approval-overview-r.ts:11,12` | Verify |
| `features/approval/types/approval-overview-s.ts:10,11` | Verify |
| `features/approval/types/approval-overview-p.ts:12` | Verify |
| `features/request/types/rebate.types.ts:30,37,39,40,44,45,46,110` | Verify `FreightColumnMeta`, `ShippingMeta` |

### Mapper / Schema

| File | Change |
|---|---|
| `features/approval/mapper/approval.mapper.ts:22,23,38,39,66,67,97,109,110` | Verify pass-through |
| `features/request/mapper/rebate.apply.ts:38,70-396` | Verify freight meta column mapping |
| `features/request/mapper/summary-rebate.mapper.tsx:22,44,56,177,246,279` | Summary display unchanged |
| `features/request/schema/rebate.schema.ts:37-369` | Schema validation unchanged |

### Display — Type R (primary impact)

| File | Change |
|---|---|
| `features/approval/components/details/type-r/overview/ViewRebateInformation.tsx:297-312` | Label "Net Freight" — verify new value renders, tooltip (+gain/−loss) unchanged |
| `features/request/components/proposal/rebate/type-r/RebateForm.tsx:91-100` | Verify |
| `features/request/components/proposal/rebate/type-r/RebateTableCard.tsx:49-186` | Verify |
| `features/request/components/proposal/rebate/type-r/RebateWrapper.tsx:115-1103` | Verify shipping meta storage |
| `features/request/components/proposal/summary/type-r/SummaryWrapper.tsx:102-103` | Verify |
| `components/rebate/RebateTable.tsx:152-1143` | Shared table — verify dropdowns |

### Display — Type S/P verify (label exists but flow check)

| File | Status |
|---|---|
| `features/approval/types/approval-overview-s.ts` | Confirm Type S use Net Freight |
| `features/approval/types/approval-overview-p.ts` | Confirm Type P use Net Freight |
| Approval markups SDM/Sam R | Storybook fixtures — update mock customer |

### Constants / Util

| File | Change |
|---|---|
| `features/approval/constants/rebate-columns.ts:23-143` | Verify column defs |
| `features/request/utils/rebate.util.ts:26,56,57` | Verify Tiered/Quota options |
| `features/request/utils/rebate-multipage.ts:132-542` | Verify payload persist |
| `features/request/utils/rebate-validate-date-overlap.ts:45` | Verify label |

### Markups (storybook fixtures)

| File | Change |
|---|---|
| `features/approval/__markups__/SDM/R/overview/DetailCard.tsx` | Update mock |
| `features/approval/__markups__/R/overview/DetailCard.tsx` | Same |
| `features/request/__markups__/R/step-2/RebateTableCard.tsx` | Same |
| `features/request/__markups__/R/step-5/RebateTableCard.tsx` | Same |

### Permission (no change)

| File | Status |
|---|---|
| `features/settings/permission/components/permissions.data.ts:32,226` | `id:"freight"` unchanged |
| `features/customers/__mocks__/permissions-data.mock.ts:36,230` | Unchanged |

### Disabled / commented

| File | Status |
|---|---|
| `features/approval/components/lists/all/index.tsx:98-101` | Already disabled — skip |

**FE file count:** ~24 files (mostly verify, no logic change since snapshot read)

## Risk / Blocker

| Item | Severity | Note |
|---|---|---|
| Sustaina group >1 customer | **High** | Need validation guard FE+BE — `400 error` if group has >1 cust before sync |
| Match >1 → error policy | **High** | **Decided**: block proposal create (error). Code เดิม `OUTER APPLY TOP(1)` ต้องลบ `TOP(1)` + count guard raise error เมื่อ >1 |
| Historical `warehouse.Subsidy` backfill | Med | `CUSTOMER_CODE='*'` wildcard, then `NOT NULL` constraint. ⚠️ no-wildcard policy แล้ว → row `'*'` เก่าจะ **ไม่ match** exact 4-part lookup (จับ `@SoldtoCode` จริงเสมอ) → กลายเป็น dead row. ต้องตัดสิน: reseed ด้วย customer จริง หรือ ปล่อย `'*'` ไว้สำหรับ historical-only (sync รอบใหม่ทับ) |
| ProposalProduct snapshot | Low | **Unchanged** — old proposal safe |
| Migration order | Med | DW view live → SP repoint → SAM migration → cutover (in order) |

## Effort vs CR1 Doc

Draft doc: BE ~9.5d, FE ~6.5d, total ~34d.

Reconciled (net-freight.md §14 updated):
- Nott view done → **BE −2d** (no DW dependency wait, no view design coord)
- **BUT** scope ใหม่ที่ draft ไม่ได้นับ: >1→error guard + remove `TOP(1)` (+1d BE), sustaina 1:1 validator (+0.5d BE, +0.5d FE), QA sustaina case (+0.5d)
- **Net:** BE 9.5→**8.5d**, FE 6.5→**7d**, QA 9→**9.5d** → total **ยังคง ~34d** — saving จาก view ถูก offset ด้วย scope ใหม่เกือบหมด

> ⚠️ "BE −2d" ใน draft แรกเป็น optimism — มองข้าม match-policy + sustaina guard. ตัวเลขจริง ~wash.

## Action Items

1. Confirm `CUSTOMER_CODE` column = `Sold-to` (Customer code) — match `Customer.SoldtoCode` field
2. ~~Confirm fallback policy~~ — ✅ Resolved: 0-match=0, >1-match=error, no wildcard (net-freight.md Q5 updated)
3. Add Sustaina group 1:1 validation (new) — FE form + BE command validator
4. QA test plan must cover: 1:1 happy path, 0-match→0, sustaina-group-multi=fail
5. Migration script + rollback ready before cutover
6. **(new)** Decide historical backfill: reseed customer จริง vs ปล่อย `'*'` historical-only — dead row ภายใต้ no-wildcard policy (block migration design)
7. **(new)** Confirm `ORGNO == SO2 == SalesOrg` mapping — naming เพี้ยนใน 3 doc (Requirement/impact/spec)
