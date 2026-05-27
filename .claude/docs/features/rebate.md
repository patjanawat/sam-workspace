# Feature: Rebate

## Overview

Rebate ใน SAM มี 2 ส่วนที่แยกกัน:

1. **ProposalRebate** — rebate config ที่ Sale Rep กำหนดบน Proposal (เก็บเป็น JSON payload ใน `ProposalDetail`) — ดูที่ proposal.md
2. **Month-End Rebate** — กระบวนการปิดรอบเดือนคำนวณและส่ง rebate ไป SAP — **นี่คือ feature นี้**

---

## Month-End Rebate Types

| Type | Stored Proc | ความหมาย |
|------|-------------|-----------|
| **Agreement** | `sp_sel_rebate_monthend` | ข้อตกลง rebate รายเดือน |
| **Accrued Sum** | `sp_sel_ar_dw` | Rebate สะสม (Accumulated) |

ทั้งสองใช้ ADO.NET โดยตรง (ไม่ใช่ EF) เพื่อรับ SQL Server OUTPUT parameters จาก stored proc.

---

## 4-Step Month-End Workflow

Tracked in `CloseMonths` table. Steps ต้องทำตามลำดับ:

| Step | Action | Stamps field |
|------|--------|-------------|
| 1 | Calculate SAP Agreement | `CalculateSAPDate` |
| 2 | Send Agreement to SAP | `SendToSAPDate` |
| 3 | Accrued Accumulated Rebate | `CalculateAccumulateDate` |
| 4 | End of Month (close) | `CloseMonthDate` |

---

## Key Backend Endpoints

| Method | Path | Operation | Auth Policy |
|--------|------|-----------|-------------|
| `POST` | `/rebates/calculate-agreement` | Calculate Agreement (sync, 5-min timeout) | Authorized |
| `POST` | `/rebates/calculate-agreement/jobs` | Calculate Agreement (async Hangfire) | Authorized |
| `GET` | `/rebates/calculate-agreement/jobs/{id}/events` | SSE progress stream | ⚠️ No auth (TODO comment in code) |
| `POST` | `/rebates/send-to-sap` | Send Agreement to SAP | Authorized |
| `POST` | `/rebates/calculate-accrued-sum` | Calculate Accrued Sum (sync) | Authorized |
| `POST` | `/rebates/calculate-accrued-sum/jobs` | Calculate Accrued Sum (async Hangfire) | Authorized |
| `GET` | `/rebates/export/agreement` | Export Agreement to Excel | `adt` or higher |
| `GET` | `/rebates/export/accrued-sum` | Export Accrued Sum to Excel | `adt` or higher |
| `GET` | `/rebates/options` | Rebate row options (for Proposal form) | Authorized |
| `GET` | `/report/send-to-sap` | Rebate report page | Authorized |

---

## Dual Execution Modes

Both Agreement and Accrued Sum support:
- **Synchronous**: endpoint waits for result (Agreement has 5-min command timeout)
- **Async Hangfire job**: returns `jobId` immediately; progress streamed via SSE `IProgressBus`; job state in `IJobStatusStore`

---

## Key Backend Files

| File | Purpose |
|------|---------|
| `Features/Rebates/CalculateAgreement/CalculateAgreementHandler.cs` | Call `sp_sel_rebate_monthend`, check `returnValue == 0`, stamp `CalculateSAPDate` |
| `Features/Rebates/CalculateAccruedSum/CalculateAccruedSumHandler.cs` | Call `sp_sel_ar_dw`, check `returnValue > 0`, stamp `CalculateAccumulateDate` |
| `Features/Rebates/SendToSap/SendRebateToSapHandler.cs` | Send Agreement to SAP, stamp `SendToSAPDate` |
| `Features/Rebates/CloseMonth/CloseMonthHandler.cs` | Close month — stamp `CloseMonthDate`, lock period |
| `Features/Rebates/Jobs/CalculateAgreementJob.cs` | Hangfire job wrapper for Agreement + SSE progress |
| `Features/Rebates/Jobs/CalculateAccruedSumJob.cs` | Hangfire job wrapper for Accrued Sum + SSE progress |
| `Features/Rebates/Export/ExportAgreementHandler.cs` | Export to Excel |
| `Features/Rebates/Export/ExportAccruedSumHandler.cs` | Export to Excel (filter: `fiperiod > period`) |
| `Features/Rebates/Options/GetRebateOptionsHandler.cs` | Rebate row options for Proposal form |

---

## Key Frontend Files

| File | Purpose |
|------|---------|
| `features/rebate/hooks/` | TanStack Query hooks for rebate operations |
| `features/rebate/components/RebateWorkflow.tsx` | 4-step workflow UI |
| `features/rebate/components/CloseMonthStatus.tsx` | Status display per step |
| `app/(protected)/rebate/` | Rebate pages |
| `app/(protected)/report/send-to-sap/` | Report: send rebate data to SAP |

---

## Business Rules & Gotchas

1. **Inconsistent success indicator**: Agreement success = `returnValue == 0`; Accrued Sum success = `returnValue > 0` — **opposite logic**. ⚠️ Don't assume same pattern.

2. **SSE endpoint has no auth**: `GET /rebates/calculate-agreement/jobs/{id}/events` — TODO comment in code, auth not yet implemented.

3. **ExportAccruedSum filter**: uses `fiperiod > period` — exports data **after** the selected period, not the period itself. This is intentional business logic, not a bug.

4. **Job deduplication**: `CloseMonth.JobIdProcessing` prevents double-run. Check this field before enqueuing new job.

5. **Auditor role (`adt`) restrictions**: can only export; cannot trigger calculations or close month.

6. **4-step must run in order**: each step checks that the previous step's date stamp is set before proceeding.

7. **ProposalRebate ≠ Month-End Rebate**: `RebatePayload`, `AccumPayload`, `SpecialPayload` on ProposalDetail are JSON strings set by Sale Rep — completely separate from this feature.

8. **`/report/send-to-sap` vs `/rebates/send-to-sap`**: rebate report page is a separate flow for close-month rebate data, guarded by `CloseMonth.JobIdProcessing`. Not the same as SAP Sync feature.

9. **ADO.NET for stored procs**: cannot use EF Core for these calls — stored procs use SQL Server OUTPUT parameters that require `SqlCommand.ExecuteNonQuery` + `SqlParameter(direction=Output)`.

---

## Related Features

- **Proposal** (`Features/Proposal/`) — `ProposalDetail.RebatePayload` stores rebate config per proposal (separate from month-end)
- **SAP Sync** (`Features/SapSync/`) — separate SAP integration; rebate has its own send-to-SAP flow
- **CloseMonth** — month-end rebate workflow is gated by CloseMonth status
- **CustomerGroup Type R** — Rebate proposals use Type R customer groups
