# Feature: Proposal / Request

## Overview

Proposal (เรียกในระบบว่า "Request") คือคำขออนุมัติราคา/โปรโมชั่น ที่ Sale Rep หรือ ASM สร้างขึ้นเพื่อส่งผ่าน Approval chain ก่อนเข้า SAP. Proposal แบ่งตาม ProposalGroup (Type P, R, S) ซึ่งกำหนดโครงสร้าง rebate, ขั้นตอนการกรอกข้อมูล, และ field ที่ส่ง BE แตกต่างกัน. ผู้ใช้หลักคือ Sale Representative (srp) และ Area Sale Manager (sam); ฝ่าย SDM/CDR/PTE อนุมัติต่อจากนั้น.

---

## Proposal Status

| Value | Enum Name | ความหมาย |
|-------|-----------|-----------|
| 0 | `Temp` | สร้างแล้ว แต่ยังไม่ได้กรอกข้อมูล (ถูกลบโดย background job) |
| 1 | `Draft` | บันทึกแล้ว ยังไม่ submit |
| 2 | `Pending` | Submit แล้ว อยู่ระหว่าง approval |
| 3 | `Approved` | อนุมัติแล้ว |
| 4 | `Rejected` | ถูกปฏิเสธ |
| 5 | `Skip` | ข้ามขั้นตอน |

Flow: `Temp(0) → Draft(1) → Pending(2) → Approved(3) | Rejected(4)`

> StatusId 0 (Temp) ถูก filter ออกจาก status summaries บน list

---

## Proposal Types (Groups)

| ID | Code | โครงสร้าง | Steps (FE) |
|----|------|-----------|------------|
| 1 | `P` | Project pricing — BigBagCharge, ContractNumber, VolumeTon, ShipPoint, Rate (ไม่มี range rebate) | 3 steps |
| 2 | `R` | DiscountHeader, NormalRebate, SpecialRebate, FreightRebate, SpecialAdditionalTHBTon, AccumulateTHBT, LoyaltyProgram (range tiers) | 5 steps |
| 3 | `S` | เหมือน R + SpecialAdditionalAmount (THB) + AccumulateAmount (THB) | 3–4 steps |

Key differences:
- **Type P**: 1 customer per proposal, มี `ProjectName` + `Products[]`, `RequestNo` สืบทอดข้ามเดือนได้เสมอ; clone ต้องเป็น Approved + SAPStatus=success
- **Type R/S**: รองรับ customers[] หลายคน, rebate ซับซ้อน, มี SpecialAdditional + Accumulate sections

---

## Key Backend Endpoints

| Method | Path | Operation | Auth Policy |
|--------|------|-----------|-------------|
| `POST` | `/requests` | Create proposal (Temp) | `[Authorize]` |
| `GET` | `/requests` | List proposals | `[Authorize]` |
| `GET` | `/proposals/search` | Search + paginate + filter | `[Authorize]` |
| `GET` | `/proposals/{id}` | Get proposal general info | `[Authorize]` |
| `PATCH` | `/proposals/{id}/general-info` | Upsert general info (step 1) | `[Authorize]` |
| `GET` | `/proposals/{id}/product-prices` | Product prices (Type P) | `[Authorize]` |
| `PUT` | `/requests/{id}/submit` | Submit → Pending + email | `"CreateProposal"` |
| `DELETE` | `/requests/{id}` | Delete proposal | `[Authorize]` |
| `GET` | `/requests/options` | Dropdown options | `[Authorize]` |
| `GET` | `/requests/request-number-options` | RequestNo options for copy | `[Authorize]` |
| `GET` | `/proposals/lookup` | Lookup by requestNo+saleOrg+version | `[Authorize]` |
| `GET` | `/requests/validate/customer-group-availability` | Validate customer group period | `[Authorize]` |
| `POST` | `/proposals/delete-inactive/jobs` | Hangfire: delete Temp proposals | `[Authorize]` |
| `POST` | `/requests/{id}/proposal-details` | Create rebate detail | `"CreateProposal"` |
| `POST` | `/proposal-details/` | Create rebate detail (alt) | `[Authorize]` |
| `PUT` | `/proposal-details/{id}` | Update rebate detail | `[Authorize]` |
| `PATCH` | `/proposal-details/{id}` | Patch rebate detail | `[Authorize]` |
| `DELETE` | `/proposal-details/{id}` | Delete rebate detail | `[Authorize]` |
| `GET` | `/proposal-details/{id}` | Get rebate detail | `[Authorize]` |
| `GET` | `/requests/{id}/proposal-customers` | Get customer list | `[Authorize]` |
| `GET` | `/requests/{id}/approve-progress` | Approval progress | `[Authorize]` |
| `GET` | `/file/{id}` | Get proposal files | `[Authorize]` |

---

## Key Backend Files

| File | Purpose |
|------|---------|
| `Features/Proposal/Create/CreateProposalHandler.cs` | Validation + clone + create Temp |
| `Features/Proposal/Create/CreateProposalValidator.cs` | FluentValidation rules |
| `Features/Proposal/SubmitProposalCommand/SubmitProposalCommandHandler.cs` | Submit + auto-approve + email |
| `Features/Proposal/PatchGeneralInfo/PatchGeneralInfoCommandRequest.cs` | General info fields (Customers[], ProposalFiles[], Products[]) |
| `Features/Proposal/Search/SearchProposalsQueryHandler.cs` | Dapper multi-result (summaries + list + total + customers) |
| `Features/Proposal/Validation/CustomerGroupAvailability/CustomerGroupAvailabilityQueryHandler.cs` | Period uniqueness check |
| `Features/Proposal/Shared/Enums/ProposalEnums.cs` | ProposalStatus, ProposalCreateMode, ProposalCopyMode |
| `Features/Proposal/Shared/Common/ProposalStatusHelper.cs` | Display names + Thai names |
| `Features/ProposalDetails/CreateCommand/CreateProposalDetailCommandHandler.cs` | Dispatch ตาม type |
| `Features/ProposalDetails/CreateCommand/CreateProposalProductTypeP.cs` | Type P TVP logic |
| `Features/ProposalDetails/CreateCommand/CreateProposalProductTypeR.cs` | Type R TVP logic |
| `Features/ProposalDetails/CreateCommand/CreateProposalProductTypeS.cs` | Type S: rebate+special+accumulate |
| `Features/ProposalCustomers/PatchProposalCustomerCommand/` | Upsert customers (delete+insert) |
| `Features/ProposalFiles/` | File upload/clone/get |
| `Shared/Constants/ProposalGroupCode.cs` | ProposalGroupEnum: P=1, R=2, S=3 |

---

## Key Frontend Files

| File | Purpose |
|------|---------|
| `features/request/hooks/useGetGeneralInfo.ts` | GET + PATCH general info |
| `features/request/hooks/useProposalDetail.ts` | POST/PATCH rebate details |
| `features/request/hooks/useProposalRebate.ts` | GET rebate options (by type) |
| `features/request/hooks/useSubmitRequest.ts` | PUT submit |
| `features/request/hooks/use-special-additional.hooks.ts` | CRUD special additionals |
| `features/request/hooks/useQueryParamActions.ts` | Step navigation helpers |
| `features/request/types/request.types.ts` | RequestItem, RequestStatus map, GetRequestListResponse |
| `features/request/types/request-general-info.types.ts` | RequestEntity, UploadItem, RemoteFile |
| `features/request/types/rebate.types.ts` | RebateFormValues, RebateRowKey enum, SectionDto |
| `features/request/types/special-additional.types.ts` | SpecialAdditional, RebateRange |
| `features/request/components/list/` | List page components |
| `features/request/components/proposal/general-info/` | Step 1 components (split by type) |
| `features/request/components/proposal/rebate/type-r/RHFRebateTable.tsx` | Main rebate table |
| `features/request/components/proposal/summary/` | Readonly summary (by type) |
| `app/(protected)/request/[id]/` | Page routes: general-info, rebate, special-additional, accumulate-amount, summary |

---

## Key Frontend Hooks

| Hook | Purpose |
|------|---------|
| `useGetGeneralInfo(id)` | GET `/proposals/{id}`, `refetchOnMount: 'always'` |
| `usePatchGeneralInfo(id)` | PATCH `/proposals/{id}/general-info` |
| `useSaveGeneralInfo(id)` | POST `/proposals/{id}/general-info` (alternative) |
| `useCreateProposalDetail()` | POST `/proposal-details` — save rebate |
| `usePatchProposalDetail(id)` | PATCH `/proposal-details/{id}` |
| `useGetRebateOptions(type, customerGroupId, saleOrgId)` | GET `/rebates/options`; Type P: requires both params, Type R/S: either |
| `useSubmitRequest(id)` | PUT `/requests/{id}/submit` |
| `useSpecialAdditionals(id)` | GET `/requests/{id}/special-additionals` |
| `usePresignProposalFiles()` | POST `/file/presign-upload` |
| `useQueryParamActions()` | `setStep`, `setParam`, `setStepWithUpdates`, `toggleBool` |

---

## Business Rules & Gotchas

1. **Year/Month validation**: สร้างได้เฉพาะ current month หรือ next month เท่านั้น
2. **Customer Group Availability**: ใน period เดียวกัน 1 CustomerGroup มีได้แค่ 1 Proposal ที่ Status Draft/Pending — ตรวจก่อน create ทุกครั้ง; ยกเว้น copy from exact same month/year
3. **Copy from Existing**: ต้องเป็น Approved proposal; Type P ต้องมี `SAPStatus = "success"` ด้วย
4. **Version Management**: version = maxVersion+1; ถ้ามี Temp อยู่ที่ maxVersion จะถูกลบแล้ว reuse version นั้น
5. **Type P RequestNo**: ข้าม month/year ยัง inherit RequestNo เดิม (version ต่อเนื่อง)
6. **Temp Cleanup**: Hangfire background job ลบ Temp proposals (Status=0); FE ไม่ควร assume proposal ยังอยู่
7. **CloseMonth Block**: submit ไม่ได้ถ้า period ถูกปิดแล้ว
8. **ASM Auto-Bypass**: submitter ที่เป็น ASM → ASM approval step ถูก auto-approve ทันที
9. **Delegation Auto-Approve**: SAM delegate → SDM auto-approve; SDM ทุกคน delegate → PT auto-approve; ตรวจจาก `UserDelegates` พร้อม date range
10. **Email on Submit**: ส่งถึง ASM เสมอ; ถ้า SDM/PT delegated ส่งถึงพวกเขาด้วย
11. **RowVersion (Optimistic Concurrency)**: `GetProposalByIdQueryResponse` มี `RowVersion` hex string
12. **Rebate Payload เป็น JSON string**: `RebatePayload`, `SpecialPayload`, `AccumPayload` ส่งเป็น JSON string; handler detect schema version ด้วย `HasSchemaVersion()` เลือก service V1 vs V2
13. **Search Role-based**: SRP เห็นของตัวเอง; ASM/SDM/CDR เห็นตาม hierarchy — logic อยู่ใน SQL ไม่ใช่ C#
14. **Dapper Multi-result**: `SearchProposalsQueryHandler` ใช้ `QueryMultiple` — 4 result sets; ถ้าแก้ SQL ต้องรักษาลำดับ result sets
15. **canCreate/canEdit/canDelete**: ส่งมาจาก BE ตาม `ProposalHelpers` — FE ใช้ control action buttons
16. **Proposal เริ่มเป็น Temp(0)**: FE create → ได้ ID กลับมา → กรอก general info → status เปลี่ยนเป็น Draft ทีหลัง (ไม่ใช่ Draft ทันที)
17. **Duplicate routes**: `POST /requests/{id}/proposal-details` vs `POST /proposal-details/` — ทั้งสองยังใช้งานได้
18. **`useSaveDraft.ts` ถูก comment out**: draft save ใช้ `usePatchGeneralInfo` แทน
19. **Type S มี 3 payload**: rebate, special, accum ส่งใน request เดียว แต่ handler แยก process แต่ละ payload
20. **ลบ range สุดท้ายของ section ต้องเคลียร์ meta เอง** (bugfix branch `clear-rebate-section-on-empty-ranges`): ใน rebate editor `components/rebate/RebateTable.tsx` → `RangesBlock.onRemove`, state ของ **ranges** (`ranges.${key}`, useFieldArray) แยกกับ **meta** (`rowsMeta.${key}.{from,to,method,includeTarget}`) และ (freight) **shipping** (`shippings.freightRebate.${colId}.{shippingPoint,shippingCondition}`) — ลบ range สุดท้าย จึง**ไม่**เคลียร์ date/method/รวมเป้า/shipping ให้อัตโนมัติ ต้อง reset เองใน `onRemove` (guard `wasLastRange = fields.length <= 1` ก่อน `remove`). Pitfalls:
    - **รวมเป้า** = controlled `SimpleCheckboxField` (`control` prop, name `rowsMeta.${key}.includeTarget.${colId}`) → `setValue` object `{}` **ไม่** re-render checkbox; ต้อง `setValue` ที่ **exact path ราย column** = `false`
    - **sentinel ว่าง = `'-1'`** (method + shipping) ตรงกับ default ใน `rebate.apply.ts` + add-column reset — ไม่ใช่ `null`/`undefined`
    - **method** ของ section ที่ `methodDisabled` หรือเหลือ option เดียว (เช่น normalRebate เมื่อมี 1 method — `rebate.util.ts:82-83`) **ห้าม reset** ไม่งั้น select ที่ disabled ค้างที่ `'-1'` แก้ไม่ได้
    - **ปลอดภัย**: Zod schema early-return เมื่อ ranges ว่าง (`rebate.schema.ts:208`, ครอบ freight shipping block 347-374 ด้วย) → reset เป็น sentinel ไม่ trigger required error
    - **Inverse ที่มีอยู่แล้ว**: set date → `addTierIfEmpty` (RebateTable.tsx:760-775) auto-สร้าง range (fix นี้ทำฝั่งตรงข้ามให้ครบคู่)

---

## P.M. Max Value / "Latest Approved Discount & Rebate" (SAM-1767)

**P.M. Max Value** (แถวใต้แต่ละ rebate section) + footer **"Latest Approved Discount & Rebate"** บนหน้า Summary = **baseline ของรอบก่อนหน้า** เพื่อเทียบกับ "Current" ของ clone proposal.

### กฎคำนวณ (footer Summary "of Proposal")
- **Current Discount & Rebate** = Σ `max(new)` แบบ **last-page-per-section** (แต่ละ section เลือกหน้าสุดท้ายที่มี range row; section หาย/ลบ range → ถอย page ก่อนหน้า per-section) — `accumulateMaxBySection`
- **Latest Approved** = Σ **`pmBaselineBySection`** (BE field) ต่อ product — **ค่าคงที่ = ยอด approved ของ proposal ก่อนหน้า** ไม่เปลี่ยนตามการแก้/ลบ page/range ของ draft ปัจจุบัน. fallback → `accumulateMaxBySection.latest` (per-page) เฉพาะตอนไม่มี field (create / ไม่มี previous)
- **Changed** = Current − Latest (อาจติดลบถ้า draft ลด rebate ต่ำกว่า baseline)

> ⚠️ **อย่าสับสน 2 grain:** แถว **P.M. Max Value (per-section, per-page)** = baseline ของ **page นั้น ๆ** (`meta.pmLastStep`); footer **Latest Approved** = ยอดรวม **ทั้ง proposal ก่อนหน้า** (`pmBaselineBySection` collapsed last-page-per-section) — คนละค่ากัน

### P.M. Max Value row — grain = (section, product, **page**)
- **source page** → baseline ของ previous page ที่ตรงกัน (เก็บของตัวเอง เช่น page2 = 23 ไม่ใช่ page1)
- **added page** (กด Add ใน session) → baseline ของ **page 1**
- อ่านจาก per-page `meta.pmLastStep` ก่อน (correct grain); fallback `pmBaselineBySection` เฉพาะหน้าที่ไม่มี per-page meta
- **ซ่อนแถว** เมื่อ section ไม่มี range row (ลบ range หมด) — editable `PmMaxStep` return null เมื่อ `ranges` ว่าง; summary `mapRebatePayloadToUI` skip เมื่อไม่มี countable row

### `isAddedPage` flag (สำคัญ — เคยเป็นบั๊ก)
- set `true` ทุกครั้งที่กด **Add New Page** (create **และ** clone, `addNewPageFromTemplate`) → **persist เข้า approved data**
- ปัญหา: clone proposal ที่หน้านึงเคย added-แล้ว-approved → สืบทอด flag → ถูกมองเป็น added → ได้ baseline page1 ผิด (ควรได้ rate ตัวเอง)
- **fix:** ตอน clone hydrate จาก source (`isSource`) → **reset `isAddedPage=false` ทุกหน้า** (`RebateWrapper` hydrate effect); เฉพาะ Add ใน session ปัจจุบันค่อย mark true → ครอบทุก generation
- BE `InjectPmMaxBaseline` **honor flag จาก payload**: added → page1 baseline; ไม่ใช่เดาจาก pageNumber collision (กัน reindex หลัง delete ทำ baseline เพี้ยน)

### Gapped PAGE → reindex baseline (สำคัญ — บั๊ก fix รอบล่าสุด, branch `bugfix/pm-max-baseline-page-reindex`)
- **อาการ:** clone proposal ที่ "เพิ่ม page" → **ทุก page โชว์ PM Max = page1** (ควรเป็น baseline ของ page ตัวเอง)
- **root cause:** previous proposal เก็บ `ProposalProductTypeRS.PAGE` แบบ **ไม่ต่อเนื่อง** (เช่น `{1,3}` หรือ `{1,4}` หลัง delete page โดยไม่ renumber). baseline query group ด้วย **raw PAGE** → key เป็น {1,3}. clone ใช้ pageNumber **ต่อเนื่อง** 1..N → `baseline.TryGetValue(2)` miss → ตก fallback page1 → ทุกหน้าได้ page1
- **fix:** `RebateHelpers.ReindexBaselinePages(baselineRaw, discountRaw)` — remap page key เป็น contiguous 1..N ก่อน inject + collapse:
  - union ของ keys (baseline ∪ discount) → `OrderBy(p)` → map page ที่ i เป็น i+1 (monotonic, รักษาลำดับ → last-page-per-section collapse ยังถูก)
  - รันใน `GetProposalDetailByIdQueryHandler` clone path: `ReindexBaselinePages` → `InjectPmMaxBaseline` → `CollapseToLastPagePerSection`
- **type-agnostic:** อยู่ใน baseline path → ครอบ **ทั้ง Type R และ Type S** (baseline query รวม SR2/AR1); แก้ที่ read-time → จัดการ data เก่าที่ gappy โดยไม่ต้อง re-save
- **ไม่กระทบ:** added-page→page1 fallback, isAddedPage guard, create flow (ไม่มี previousId) — เดิมทั้งหมด
- verified: gap {1,4}, multi-product, modify/add/delete, edit added page, Type R + **Type S clone** — ไม่ regression

### Baseline มาจาก **BE** (ไม่ใช่ localStorage)
- baseline = `max(RATE)` ต่อ `(PAGE, PRODUCT_CODE, RATE_TYPE)` ของ **previous proposal** (`Proposal.PreviousId`, level เดียว)
- BE inject ลง `meta.pmLastStep` ของ payload ตอน `GetProposalDetailById` → FE อ่านตรง ๆ **เฉพาะตอนดู proposal** → **request + approval + ทุก user เห็นเหมือนกัน** (เดิมใช้ localStorage → approval อ่านไม่ได้ = บั๊ก). **ยกเว้นตอน clone (`isCopy`)** — FE rebuild เอง (ดู § Clone stale-generation ด้านล่าง)
- BE key files: `Features/ProposalDetails/GetByIdQuery/GetProposalDetailByIdQueryHandler.cs` (`BuildPmMaxBaselineAsync` group ด้วย raw PAGE + `CollapseToLastPagePerSection`) + `Shared/Helpers/RebateHelpers.cs` (`RateTypeToSectionKey` = single source of truth, `InjectPmMaxBaseline`, **`ReindexBaselinePages`** remap gappy PAGE → contiguous)
- FE: `mapper/rebate-footer.mapper.tsx` (Current = `accumulateMaxBySection`; Latest = `sumBaselineByProduct(pmBaselineBySection)`), `mapper/summary-rebate.mapper.tsx` (per-section row อ่าน `meta.pmLastStep` ก่อน + ซ่อนเมื่อไม่มี range), `mapper/rebate.apply.ts` (lift `meta.pmLastStep` → formValues; **isCopy rebuild = max(new)**), `components/rebate/PmMaxStep.tsx` (editable, return null เมื่อไม่มี range), `RebateWrapper.tsx` (clone hydrate reset `isAddedPage`; `applyPmMaxToRowsMeta` override เฉพาะ added page)

### RATE_TYPE → section key (รองรับ Type R + S)
| RATE_TYPE | code | section key | type |
|---|---|---|---|
| NormalRebate | NR1 | normalRebate | R, S |
| SpecialRebate | SR1 | specialRebate | R, S |
| FreightRebate | FR1 | freightRebate | R, S |
| LoyaltyProgram | SR3 | loyaltyProgram | R, S |
| SpecialAdditionalThbTon | SR2 | specialAdditionalTHBTon | **S** |
| AccumulateThbTon | AR1 | accumulateTHBT | **S** |
- **Discount** ไม่อยู่ใน map → ไม่ inject (ใช้ `max(old)` ใน Latest)
- **Type P** (SR4/AR2 Amount) **ยังไม่ครอบ** — เพิ่มใน `RateTypeToSectionKey` ถ้าต้องรองรับ

### Gotchas
- **create proposal** = ไม่มี `PreviousId` → BE ไม่ inject → ไม่มี PM Max row, Latest = 0/`max(old)`. **อย่า inject ให้ create**. fix ทั้งหมด gate ที่ clone (`isClone`/`previousId`) → create ไม่กระทบ
- **Summary Latest ≠ Rebate-page Latest:** Summary footer = "of Proposal" (ทั้ง proposal, Latest = `pmBaselineBySection` คงที่); Rebate editable footer = "(This Page)" (per-page baseline) — คนละ builder, แก้ Summary ไม่กระทบ Rebate page
- **Latest Approved (Summary) ต้องคงที่ = 289-style** (ยอด previous approved); อย่าผูกกับ page ปัจจุบัน (เคยพลาด: เปลี่ยนไปใช้ per-page → ลบ page แล้ว Latest ตกจาก 289→29)
- **reindex page = deferred:** delete page = soft-flag (`deleted:true`) ไม่ renumber; `reindexPages` (1,3,4→1,2,3) รันเฉพาะตอน **hydrate** (`didHydrateRef` one-shot guard) = reload/remount ไม่ใช่ตอน delete หรือ back ที่ไม่ remount
- payload section key = RebateRowKey (`specialAdditionalTHBTon`); ระวัง `summary-rebate.mapper` SECTION_KEY_MAP map ไป uiKey `specialAddTHB` (คนละตัวกับ payload key)
- PM Max = baseline คงที่ **ไม่เปลี่ยนตามค่า new ที่แก้** (มาจาก previous) — ต่างจาก Current ที่เปลี่ยนตาม new
- **FE isAddedPage-reset = Type R เท่านั้น** (`RebateWrapper` type-r); Type P/S ใช้ component path แยก. แต่ **BE fix (`ReindexBaselinePages` + `InjectPmMaxBaseline` + baseline query) = type-agnostic** → ครอบ Type S clone ด้วย (verified S2600032/S2600011) — อย่าสับสนสองชั้นนี้

### QA verified — multi-generation clone (SAM-1810)
- **scenario:** clone chain v0 → v1 → v2 (`J-S002-R2600013`, Type S) — เดิม v2 หน้า 1 โชว์ P.M. Max ผิด (Normal=`1` ควร `3`), หน้า 2 ถูก (`6`) → per-page ไม่ตรง baseline
- **after fix:** P.M. Max row = baseline คงที่ทุก page + Summary (Normal `3` / Special `6` / Freight `9` / Loyalty `10`) แม้แก้ค่า `new` ต่อหน้า (หน้า2 Normal `23/22/21`, หน้า3 `33/32/31` → PM Max ยัง `3`)
- **footer reconcile:** Current `399` = `accumulateMaxBySection` last-page-per-section (`1 + 33[p3] + 26[p2] + 29[p2] + 310[p3]`); Latest Approved `29` = baseline (`1+3+6+9+10`, คงที่ทุกหน้า); Changed `370` = `399−29` — ครบทั้ง 3 ค่า ไม่ regression (QA screenshot 2026-06-30)
- ⚠️ residual พบ 2026-07-02 → SAM-1810 รอบ 2 ด้านล่าง

### Clone stale-generation baseline (SAM-1810 รอบ 2, branch `bugfix/SAM-1810-clone-pm-max-stale-generation`)
- **อาการ:** clone v1→v2 → P.M. Max หน้า 1 ของ v2 โชว์ค่า **v0** (ข้ามรุ่น) เช่น v1 approved 31/61/91/121 แต่โชว์ 30/60/90/120; หน้า 2 "ดูถูก" แค่บังเอิญ
- **root cause:** clone rebate step fetch `GET(sourceId=v1)` (`getRefId`, `request.util.ts`) → BE inject `meta.pmLastStep` = baseline ของ `v1.PreviousId` = **v0** — ถูกสำหรับ "ดู v1", stale 1 รุ่นสำหรับ "สร้าง v2". FE lift verbatim ตั้งแต่ `f56ff940` (PR #1435 ลบ isCopy rebuild → แลกบั๊ก last-row-overwrite เดิมกับ stale-generation)
- **fix (FE-only, `mapper/rebate.apply.ts`, commit `83f64e0a`):** ตอน `isCopy` rebuild `pmLastStep` = **`Math.max(new)` ต่อ product ต่อ section** จาก rows ของ source เอง (`maxNewByProduct` + `resolvePmValue`) — ต้อง max ทุก row **ไม่ใช่ last row** (บั๊ก Type S เดิมที่ PR #1435 พยายามแก้); non-copy ใช้ BE meta ตามเดิม
- **latent bug คู่กัน (เจอจาก test):** isCopy loop `old:=new` เคยทับ bucket `values.<section>.pmLastStep` เป็น `{old:undefined,new:undefined}` → sticky baseline หาย — fix: skip key `PM_BUCKET` (file-local const `'pmLastStep'`, ชื่อเดียวกับ `PmMaxStep.tsx`, commit `01200b7a`)
- **ทำไมหน้า 2 เดิมดูถูก:** `rowsMeta.pmLastStep` absent (added-page strip ใน v1) → `PmMaxStep` fallback `lastOld` ซึ่ง old=new บน clone → ตรงโดยบังเอิญ ไม่ใช่ logic ถูก
- **verify:** one-off tsx script 9/9 (repo ไม่มี FE test framework) + tsc + eslint clean — รายละเอียด `tasks/SAM-1810/`

---

## Related Features

| Feature | ความสัมพันธ์ |
|---------|-------------|
| **Approval** | Proposals ที่ submit เข้า Approval workflow — `Features/Approval/` |
| **ApprovalHistories** | Log approve/reject/delegate — `GET /requests/{id}/approve-progress` |
| **Rebates** | `GET /rebates/options` — rebate row options ตาม type |
| **SapSync** | Approved proposals sync ไป SAP; Type P ต้อง SAPStatus=success ก่อน copy |
| **UserDelegate** | ส่งผลต่อ auto-approve logic ใน Submit |
| **CloseMonth** | Block submit เมื่อ period ถูกปิด |
| **ProposalFiles** | แนบไฟล์ผ่าน MinIO — `Features/ProposalFiles/` |
| **CustomerGroups** | Proposal ผูกกับ CustomerGroup — ตรวจ availability ก่อนสร้าง |
