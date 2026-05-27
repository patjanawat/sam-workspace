# Feature: Customer Group & Relation

## Overview

Customer Group และ Customer Relation เป็น 2 entity ที่ใช้จัดกลุ่มลูกค้า (Soldto) ในระบบ SAM แต่มีวัตถุประสงค์และพฤติกรรมต่างกัน ทั้งสองถูก manage ผ่าน `/customers/groups` และ `/customers/relations` ตามลำดับ

---

## Customer Group vs Customer Relation

| มิติ | Customer Group | Customer Relation |
|------|---------------|-------------------|
| วัตถุประสงค์ | กลุ่มลูกค้า+สินค้า ที่ผูกกับ Proposal (Type P/R/S) | ความเชื่อมโยงระหว่างลูกค้า ใช้ตรวจ overlap/duplication |
| Code format | `P00001`, `R00001`, `S00001` (prefix = ProposalGroup code) | `CR0001`, `CR0002` (running number) |
| ผูกกับ | SaleOrg + SaleOffice + ProposalGroup + Region (PAM Province) | ไม่ผูกกับ org — เป็น standalone relation |
| มี Products | ใช่ (M2M `CustomerGroup_Product`) | ไม่มี |
| มี Customers | ใช่ (M2M `CustomerGroup_Cust`) | ใช่ (`CustomerRelationMapping`) |
| Overlap check | ไม่มี | มี — endpoint `/customers/relations/overlaps` |
| Optimistic concurrency | ใช่ — RowVersion (hex string) | ไม่มี |
| Code is immutable | ใช่ | ใช่ |
| Type P constraint | มีได้แค่ 1 customer | ไม่มีข้อจำกัดจำนวน |
| ผู้ manage | SRP สร้างได้, SAM เห็น subordinate's groups | `sla` role เท่านั้น Create/Edit ได้ |

---

## Key Backend Endpoints

### Customer Groups

| Method | Path | Auth Policy | หมายเหตุ |
|--------|------|-------------|----------|
| POST | `/customers/groups` | `CreateCustomerGroup` | สร้าง group พร้อม customers/products |
| GET | `/customers/groups/search` | `[Authorize]` | List+paging+filter ด้วย Dapper (แนะนำ) |
| GET | `/customers/groups/{id}` | `[Authorize]` | ดึงรายละเอียด พร้อม customers/products/RowVersion |
| GET | `/customers/groups/available-option` | `[Authorize]` | Filter by saleOrg, year, month, proposalGroup |
| GET | `/customers/groups/option` | `[Authorize]` | Dropdown options |
| PUT | `/customers/groups/{id}` | `CreateCustomerGroup` | Update เฉพาะ FromDate/ToDate + RowVersion |
| GET | `/customers/search` | `[Authorize]` | ค้นหา Soldto สำหรับเลือก customer ใน group |

### Customer Relations

| Method | Path | Auth Policy | หมายเหตุ |
|--------|------|-------------|----------|
| POST | `/customers/relations` | `CreateCustomerGroup` | สร้าง relation พร้อม members |
| GET | `/customers/relations` | `[Authorize]` | List+paging+search (q param) |
| GET | `/customers/relations/{id}` | `[Authorize]` | ดึงรายละเอียด พร้อม members |
| PUT | `/customers/relations/{id}` | `CreateCustomerGroup` | Update name/dates/members (replace strategy) |
| GET | `/customers/relations/next-code` | `[Authorize]` | ดึง code ถัดไป preview (ไม่ reserve) |
| GET | `/customers/relations/overlaps` | `CreateCustomerGroup` | ตรวจ overlap (soldToCodes query string) |
| POST | `/customers/relations/overlaps` | `CreateCustomerGroup` | ตรวจ overlap (body) |

---

## Key Backend Files

```
Features/CustomerGroup/
  Create/   — CreateCustomerGroupEndpoint.cs + CreateCustomerGroupCommandHandler.cs
  GetById/  — loads customers + products + RowVersion
  SearchGroup/ — SearchCustomerGroupQueryHandler.cs (Dapper multi-result) + SearchCustomerGroupSql.cs (5-CTE raw SQL)
  Search/   — SearchCustomerEndpoint.cs + SearchCustomerQueryHandler.cs (Soldto search)
  Update/   — UpdateCustomerGroupHandler.cs (date only, optimistic concurrency)
  GetOptions/ — available-option + dropdown options

Features/CustomerRelation/
  Create/   — CreateCustomerRelationHandler.cs (auto-gen CR code + member save)
  GetById/  — includes members + customer names from Soldto join
  List/     — paging + sort + search
  NextCode/ — CR code preview
  Overlap/  — GetOverlapCustomersHandler.cs (GET + POST, date-range aware)
  Update/   — replace-strategy member sync
```

---

## Key Frontend Files

```
features/customers/
  groups/hooks/index.ts          — useGetCustomerGroupListQuery, useGetCustomerGroupQuery, useGetCustomerGroupOptionQuery, useGetCustomersInGroupId
  groups/details/hooks/index.ts  — useGetCustomerGroupByIdQuery, useCreateCustomerGroup, useUpdateCustomerGroup, useGetCustomerOptionQuery
  groups/types/customer-groups.ts — CustomerGroup, Summary, GetCustomerGroupListResponse
  groups/details/types/          — GetCustomerGroupByIdResponse, CreateCustomerGroupRequest/UpdateCustomerGroupRequest
  relations/components/RelationsListWrapper.tsx  — list table, sla-only Create button
  relations/components/RelationDetailForm.tsx    — form + real-time overlap detection UI
```

---

## Key Frontend Hooks

| Hook | Purpose |
|------|---------|
| `useGetCustomerGroupListQuery(params)` | List+summaries จาก `/customers/groups/search` |
| `useGetCustomerGroupQuery(params)` | List จาก `/customers/groups` (legacy) |
| `useGetCustomerGroupOptionQuery(params)` | Dropdown options |
| `useGetCustomersInGroupId(id)` | Customers ใน group (skip ถ้า SELECT_ALL_ID) |
| `useGetCustomerGroupByIdQuery(id)` | GET detail พร้อม RowVersion |
| `useCreateCustomerGroup()` | POST create |
| `useUpdateCustomerGroup(id)` | PUT update |
| `useGetCustomerOptionQuery(params)` | Soldto search dropdown |

---

## Business Rules & Gotchas

**Customer Group:**

1. ProposalGroup code ต้องเป็น `P`, `R` หรือ `S` เท่านั้น — validate ก่อน save
2. **Type P มี customer ได้แค่ 1 รายการ** — ส่ง > 1 จะ throw `ApiValidationException` (400)
3. **Code generation ใช้ optimistic retry loop สูงสุด 5 รอบ** เพื่อรับมือ race condition บน unique constraint; format: `{P|R|S}{5-digit}` เช่น `P00001`
4. **Code immutable** — EF `IsModified = false` บน Code property ใน Update handler
5. **RowVersion (hex string) บังคับใน PUT** — stale จะได้ 400 "The record was modified by another user"
6. **Status คำนวณ server-side (Bangkok TZ)**: Active / Upcoming / Expire
7. **Role-based SQL visibility**: `srp` เห็นเฉพาะ group ตัวเอง, `sam` เห็นตัวเอง + subordinates (ReportToId), role อื่นเห็นทั้งหมด
8. **Customer search scope**: filter ตาม SaleGroupCode ของ user (หรือ SaleOfficeCode ถ้าไม่มี SaleGroupCode) — max 1000 records
9. **Group name format**: `{Code} - {RegionName}` เช่น `P00001 - Bangkok`
10. **Update เปลี่ยนได้เฉพาะ FromDate/ToDate** — Customers/Products แก้ไขไม่ได้หลัง create

**Customer Relation:**

1. **Code format**: `CR{4-digit}` เช่น `CR0001` — auto-generate ตอน create; `next-code` endpoint เป็นแค่ preview (ไม่ reserve)
2. **Member sync ใช้ replace strategy** — delete members ที่ไม่อยู่ใน desired + add ที่ยังไม่มี (keyed on `(SoldToCode, OrgNo)`)
3. **Overlap detection real-time บน FE** — `RelationDetailForm` เรียก overlap API ทุกครั้งที่ customers หรือ dates เปลี่ยน แสดง warning table ถ้ามี overlap
4. **`excludeRelationId`** — ส่งตอน edit เพื่อไม่ให้ตรวจ overlap กับตัวเอง
5. **ValidTo เป็น nullable** — `null` = ไม่มีวันหมดอายุ; FE ใช้ defaultDateOnClear = `"9999-12-31"`
6. **Overlap date range logic**: `(R.ValidTo IS NULL OR R.ValidTo >= from) AND (to = MaxDate OR R.ValidFrom <= to)`
7. **`sla` role เท่านั้น** ที่ Create/Edit Relation ได้ — ตรวจบน FE `role === 'sla'`
8. FE ใช้ GET ตลอด สำหรับ overlaps endpoint (comma-separated `soldToCodes=1001,1002`)

---

## Related Features

- **Proposal** — CustomerGroup ถูก reference ใน Proposal เพื่อกำหนด customers/products ที่ครอบคลุม
- **ProposalGroup** — กำหนด Type (P/R/S) ของ CustomerGroup — entity ใน `core.ProposalGroup`
- **SaleOrg / SaleOffice** — CustomerGroup ผูกกับ org hierarchy
- **Region (PAM Province)** — ใช้ตั้งชื่อ Group และ filter customer search
- **Rebate** — CustomerGroup Type R ใช้ในการคำนวณ Rebate
- **User Roles** — `srp`/`sam`/`sla` มี visibility และ edit permission ต่างกัน
