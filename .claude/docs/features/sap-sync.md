# Feature: SAP Sync

## Overview

SAP Sync ใน SAM มี 3 sub-system ที่แยกกัน:

1. **Auto-sync on CDR approval** — Hangfire job เรียกอัตโนมัติหลัง Commercial Director อนุมัติ Proposal
2. **Re-sync management page** (`/sap-sync`) — manual re-sync สำหรับ Proposals ที่ sync ล้มเหลว
3. **Rebate report send-to-SAP** (`/report/send-to-sap`) — ส่งข้อมูล rebate เดือนปิดไป SAP (แยกจาก 2 ข้อบน)

---

## Two Separate DbContexts

| Context | ใช้สำหรับ |
|---------|----------|
| `SamAppDbContext` | SAM application data (Proposals, Approvals, etc.) |
| `SAPDbContext` | SAP staging tables (ส่งข้อมูลผ่าน staging table แทนการ call SAP โดยตรง) |

---

## 1. Auto-Sync on CDR Approval

เกิดเมื่อ Commercial Director อนุมัติ Proposal:

```
CDR approves → ApprovalService → ISapGenerateService → routes by ProposalGroup:
  Type P (project) → CreateContractAsync
  Type R (rebate)  → CreateDiscountAsync  
  Type S (special) → ChangeContractAsync
→ ISapSyncService.Enqueue (Hangfire job)
```

Handler: `ApprovalService.cs` → `ISapGenerateService` + `ISapSyncService`

---

## 2. Re-Sync Management Page (`/sap-sync`)

Shows all proposals with `SAPStatus = 'fail'` AND `ProposalStatus = Approved`.

| Operation | Endpoint | ความหมาย |
|-----------|----------|----------|
| Single resend | `POST /sap-sync/{id}` | Sync proposal เดี่ยว (synchronous) |
| Batch resend | `POST /sap-sync/batch/jobs` | Hangfire job + SSE progress |

**Batch scope: current month only** — historical failures ต้อง retry ทีละรายการ

---

## 3. Rebate Report Send-to-SAP (`/report/send-to-sap`)

Separate flow for close-month rebate data. Gated by `CloseMonth.JobIdProcessing`. ดูรายละเอียดที่ rebate.md.

---

## SAP Success Indicators

⚠️ **Different per flow** — อย่า assume ว่าเหมือนกัน:

| Flow | Success value |
|------|--------------|
| Create Discount (Type R) | `"0"` |
| Create Contract (Type P) | `"C"` |
| Change Contract (Type S) | `"S"` |

---

## Key Backend Endpoints

| Method | Path | Operation | Auth Policy |
|--------|------|-----------|-------------|
| `GET` | `/sap-sync` | List proposals with SAP failures | Authorized |
| `POST` | `/sap-sync/{id}` | Re-sync single proposal | Authorized |
| `POST` | `/sap-sync/batch/jobs` | Batch re-sync (Hangfire + SSE) | Authorized |
| `GET` | `/jobs/{jobId}/events` | SSE progress stream | Authorized |

---

## Key Backend Files

| File | Purpose |
|------|---------|
| `Features/SapSync/GetFailedProposals/GetSapSyncListHandler.cs` | List proposals with SAPStatus=fail + Approved |
| `Features/SapSync/ResyncSingle/ResyncSingleHandler.cs` | Re-sync single proposal |
| `Features/SapSync/ResyncBatch/ResyncBatchJobHandler.cs` | Hangfire job: batch re-sync current month |
| `Features/SapSync/Shared/SapSyncService.cs` | Core SAP sync logic — calls ISapGenerateService |
| `Features/SapSync/Shared/SapSyncServiceFallback.cs` | Fallback implementation — dev/test environments without SAP RFC connector DLL |
| `Features/SapSync/Shared/ISapGenerateService.cs` | Interface: CreateDiscountAsync, CreateContractAsync, ChangeContractAsync |
| `Features/Sync/SamSyncJob.cs` | Hangfire hourly job — sync master data from data warehouse (NOT SAP ERP sync) |
| `Features/Sync/SamMonthlySyncJob.cs` | Hangfire daily job (days 1–5 only) — sync monthly master data (NOT SAP ERP sync) |
| `Infrastructure/SAP/SAPDbContext.cs` | Staging table DbContext |

---

## Key Frontend Files

| File | Purpose |
|------|---------|
| `features/sap-sync/hooks/` | TanStack Query hooks for sync operations |
| `features/sap-sync/components/SapSyncList.tsx` | Table of failed proposals |
| `features/sap-sync/components/ResyncButton.tsx` | Single resync trigger |
| `features/sap-sync/components/BatchResyncButton.tsx` | Batch resync + SSE progress |
| `app/(protected)/sap-sync/` | SAP Sync management page |

---

## Business Rules & Gotchas

1. **`SapSyncServiceFallback` exists**: in environments without the SAP RFC connector DLL, use the fallback implementation. Register via DI based on config flag.

2. **Batch re-sync is current month only**: historical SAP failures older than current month cannot be batch-processed — must retry individually.

3. **Two unrelated "Sync" features**: `Features/Sync/SamSyncJob.cs` (hourly) and `SamMonthlySyncJob.cs` (days 1–5) sync **master data from data warehouse** — not SAP ERP sync. They live in `Features/Sync/`, not `Features/SapSync/`.

4. **Success indicators differ**: `"0"` = discount success, `"C"` = contract created, `"S"` = contract changed. Never compare SAP responses without knowing which flow you're in.

5. **SAPDbContext is separate**: SAP integration writes to staging tables, not SAM tables. Don't inject `SamAppDbContext` where `SAPDbContext` is needed.

6. **Rebate send-to-SAP is separate feature**: `/report/send-to-sap` is close-month rebate data, not proposal sync. Gated by CloseMonth, uses different service.

7. **CDR approval triggers sync automatically**: no manual action needed after CDR approval — `ApprovalService` enqueues sync job. Don't double-enqueue.

---

## Related Features

- **Approval** (`Features/Approval/`) — CDR approval triggers SAP sync via `ApprovalService`
- **Proposal** — Proposal with `SAPStatus = 'fail'` shows up in re-sync list
- **Rebate** (`Features/Rebates/`) — Month-end rebate has its own separate send-to-SAP flow
- **Jobs** — SSE progress via `/jobs/{jobId}/events` (same pattern as approval bulk jobs)
