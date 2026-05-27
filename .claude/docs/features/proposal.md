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
