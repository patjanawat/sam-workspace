# CR#3 Add Customer Segment field — Impact Analysis (FE/BE)

**Sources:**
- Meeting: `docs/CR5-review-meeting-summary.md` ข้อ 3
- Codebase: SAM submodule (`web/web/backend/`, `web/web/frontend/`)

**Change summary:** เพิ่ม `Customer Segment` column ในกรอบ Customer ของ General Information page — ดึง by Customer Code จาก DW view ของ Nott

## Backend Impact

### Entity / DbContext / Migration

| File | Change | Severity |
|---|---|---|
| `Entities/SoldTo.cs:1` | Add `CUSTOMER_SEGMENT` field (`string?`) | M |
| `Database/SamAppDbContext.cs:271` (SoldTo mapping) | Add property config, nullable | L |
| New EF migration `AddSegmentToSoldTo` | `ALTER TABLE warehouse.SoldTo ADD CUSTOMER_SEGMENT nvarchar(64) NULL` | L |
| `Entities/ProposalCustomer.cs:3` | **No change** — snapshot SOLDTO_CODE/NAME only (segment looked up live or snapshot? — see Q below) | — |

### DW Sync

| File | Change |
|---|---|
| `Features/Sync/SamSyncService.cs:21` | Unchanged — call `sp_Sync_Customer` |
| `Sql/PamDB/Store-view/sp_Sync_warehouse.sql:9` `sp_Sync_Customer` | **Nott add `CUSTOMER_SEGMENT` to source view + Manao add to MERGE column list + UPDATE SET** |

### Mass Update (2026 backfill)

| Step | Owner |
|---|---|
| 1. Wait Nott update DW view + ETL | Nott |
| 2. Run `sp_Sync_Customer` → warehouse.SoldTo populated with segment | Manao |
| 3. **No migration program** — proposals read segment via JOIN to SoldTo at read time (no per-proposal snapshot needed) | — |

→ Cleaner if **no snapshot in ProposalCustomer** (always live JOIN). Confirm with BA: change segment after proposal create → reflect in view or freeze?

### Proposal Read

| File | Change |
|---|---|
| `Features/ProposalCustomers/ProposalCustomerQuery/ProposalCustomerQueryHandler.cs:14` | Add JOIN to SoldTo, SELECT `CUSTOMER_SEGMENT` |
| `Features/ProposalCustomers/ProposalCustomerQuery/ProposalCustomerQueryResponse.cs:5` | Add `string? CustomerSegment` field |
| `Features/Proposal/GetById/GetProposalByIdQueryHandler.cs:52-57` | Customers list — add segment via SoldTo JOIN |
| `Features/Approval/Sam/Search/GetApprovalSamQueryHandler.cs:140` | List aggregation — verify segment carry-through |
| `Features/Approval/Search/SearchApprovalSql.cs:22` | Verify segment if needed in list view (likely not — only detail) |

### Approval detail (per role × type)

Customer block displayed on all approval pages (ASM, Pricing, CD, Summary). Backend changes flow via `ProposalCustomerQueryResponse` → reused. No per-role handler change needed.

### Tests

| File | Change |
|---|---|
| `SamApp.WebApi.Tests/...` | Update `SoldTo` entity test, add segment JOIN test, ensure 1:1 customer constraint (per meeting) |

**BE file count:** ~5 files + 1 migration + tests

## Frontend Impact

### Types / DTO

| File | Change |
|---|---|
| `features/request/types/proposal-customer-query-response.ts:1` | Add `customerSegment?: string` |
| `features/request/types/request-general-info-customer.types.ts:1` `GeneralInfoCustomer` | Add `customerSegment?: string` |
| `features/request/types/get-proposal-by-id-query-response.ts:43,46` | Add `customerSegment` in customers array |
| `features/request/types/patch-general-info-command-request.ts:20` | **No change** — patch only sends customer IDs, segment read-only from server |

### Schema

| File | Change |
|---|---|
| `features/request/schema/general-info.schema.ts:40,109,171` | Add `customerSegment` to schema (read-only, optional) |

### Display — Customer block (General Info page)

| File | Change |
|---|---|
| `features/request/components/proposal/general-info/type-r/CustomersCard.tsx:18-72` | Add column: `id: 'customerSegment', header: 'Customer Segment / กลุ่มลูกค้า'` between customerName (line 18) and provinceName (line 24) — per Art "ระหว่างชื่อลูกค้ากับจังหวัด" |
| `features/request/components/proposal/general-info/GeneralInfoCard.tsx:102` | Pass segment through customersOptions mapping |

### Display — Approval views

| File | Change |
|---|---|
| `features/approval/components/details/type-r/summary/ViewCustomers.tsx:14-24` | Add segment column (same position) |
| `features/approval/components/lists/all/ViewCustomers.tsx:14` | Add column if list-level display required (verify with BA — meeting said per-customer block) |

### Type S / Type P

| File | Action |
|---|---|
| Equivalent `type-s/CustomersCard.tsx` / `type-p/CustomersCard.tsx` | **Search + verify** — same column add (meeting: "ทุก page render proposal") |
| Approval Type S/P customer views | Same |

### Customer group page (out of scope per meeting, verify only)

| File | Status |
|---|---|
| `features/customers/groups/hooks/index.ts:33` `useGetCustomersInGroupId` | Verify segment ไม่กระทบ existing group create/edit |

### i18n

| File | Change |
|---|---|
| `lib/i18n/locales/en.json` / `th.json` | Add label "Customer Segment" / "กลุ่มลูกค้า" |

**FE file count:** ~10-12 files (Type R + S + P × CustomersCard + ViewCustomers + types + schema + i18n)

## Constraints (per meeting)

| Rule | Enforcement |
|---|---|
| 1 customer = 1 segment | DB constraint: SoldTo.SOLDTO_CODE = PK, segment = single field (1:1 implicit) |
| Sustaina group ต้องมี 1 customer (relate CR1) | FE validation on customer group create — out of scope CR3 but related |
| Read-only field | FE — render as text, no input control |

## Risk / Blocker

| Item | Severity | Note |
|---|---|---|
| DW view ETA (Nott) | **Med** | Blocker — view + ETL must populate before mass update |
| Snapshot vs live segment | **Med** | If segment changes after proposal create — Q to BA: freeze in `ProposalCustomer` or live JOIN? Meeting suggests live (no snapshot) |
| Backfill scope = 2026 ทั้งปี | Low | Mass UPDATE SQL หลังบ้าน — no app code, no rollback complexity |
| Approval list (search) display | Low | Confirm with BA: per-customer block or list-level column |
| Type S/P parity | **Med** | Search Type S/P CustomersCard equivalents — same column position |
| i18n consistency | Low | TH label wording — confirm with Art |

## Effort Estimate

| Phase | Effort |
|---|---|
| BE entity + DbContext + migration | 0.3 d |
| BE `sp_Sync_Customer` + sync verify | 0.3 d |
| BE ProposalCustomerQuery + response | 0.5 d |
| BE tests | 0.5 d |
| FE types + schema | 0.3 d |
| FE CustomersCard (R/S/P × 2 = General Info + Approval Summary) | 1.5 d |
| FE i18n | 0.2 d |
| FE component tests | 0.5 d |
| Code review + QA + UAT | 1.5 d |
| **Total** | **~5.6 d** |

## Action Items

1. Confirm with Art/Nott: snapshot in `ProposalCustomer` or live JOIN? (live recommend)
2. Confirm DW view ETA (Nott) — blocker
3. Locate Type S + P `CustomersCard` equivalents (Type R found, S/P need verify)
4. Confirm approval list view — add column or detail-only
5. Mass update SQL script + run plan (ปี 2026)
6. i18n wording
