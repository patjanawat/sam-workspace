# QA Manual — หน้า เงินคืน / Rebates: ปิดรอบ Month-End 4 ขั้น (`/rebates`)

> เวอร์ชัน: 2026-07-03 · อ้างอิง code: SAM repo branch `develop` @ `356bd3fd`
> ครอบคลุม: stepper 4 ขั้น, ปุ่มทั้ง 6 ปุ่ม, ลำดับบังคับ, role, job/SSE behavior

---

## 1. หน้านี้ทำอะไร

กระบวนการ **ปิดรอบ rebate รายเดือน** 4 ขั้นตอน ทำงานต่อ **งวด (ปี+เดือน)** ที่เลือกจาก dropdown:

```
1. Calculate SAP Agreement  →  2. Send Agreement to SAP  →  3. Accrued Accumulated Rebate  →  4. End of Month
```

- สถานะแต่ละขั้นเก็บในตาราง `CloseMonths` (1 แถวต่องวด YYYYMM) เป็น date stamp + user
- Stepper ด้านบนแสดง: ขั้นเสร็จ = วงกลมเขียว ✓ + ชื่อคนทำ + วันเวลา (UTC+7); ยังไม่เสร็จ = นาฬิกา
- เปลี่ยนปี/เดือน → stepper + ปุ่มทั้งหมด refresh ตามงวดนั้น

---

## 2. กติกาพื้นฐาน

1. **ต้องเลือกปี + เดือนก่อน** — ยังไม่เลือก (หรือค่า "เลือกทั้งหมด") = ทุกปุ่ม disabled
2. **ลำดับบังคับ ข้ามขั้นไม่ได้** — ปุ่มแต่ละตัวเปิดเมื่อขั้นก่อนหน้าเสร็จเท่านั้น
3. **ปิดเดือนแล้ว (step 4) = จบ** — ทุกปุ่ม action ล็อค เหลือ Export 2 ปุ่ม
4. งานคำนวณ/ส่ง SAP เป็น **background job (Hangfire)** — FE ฟังผลผ่าน SSE realtime; ปุ่มหมุนจนจบ

---

## 3. Flow ข้อมูล: Input → Process → Output

**ข้อมูลตั้งต้น:** ตอน CDR approve proposal (ขั้นสุดท้าย) ระบบ insert แถวลง `dbo.proposal_for_cal` (1 แถวต่อ ลูกค้า × สินค้า × rate type × tier) — นี่คือวัตถุดิบของการคำนวณทั้งหมด. **งวดที่ไม่มี proposal approved = Calculate จะ "สำเร็จแต่ไม่มีข้อมูล"**

| Step | Input | Process | Output (ตาราง DB) |
|---|---|---|---|
| 1. Calculate Agreement | `proposal_for_cal` ของงวด | job รัน SP `sp_sel_rebate_monthend` — loop 2 org (S854, S899) คำนวณ tier/rate; **guard: มี Agreement งวดนี้แล้ว → return สำเร็จทันที ไม่คำนวณซ้ำ** | **`dbo.Agreement`** + stamp `CalculateSAPDate` |
| 2. Send to SAP | `dbo.Agreement` ของงวด | dedup `JobIdProcessing` → job `CreateRebateAsync` → สร้าง agreement ใน **SAP ERP** | SAP + stamp `SendToSAPDate` |
| 3. Calculate Accrued | `proposal_for_cal` เฉพาะ `drtype` ขึ้นต้น `'AR'` | job รัน SP `sp_sel_ar_dw` — คำนวณสะสม แยกงวดขาย (sd) / งวดบัญชี (fi) | **`dbo.AR_DW`** + **`dbo.AR_DW_TYPE_Z`** + stamp `CalculateAccumulateDate` |
| 4. End of Month | step 2+3 ครบ | `PUT /close-months/{period}` | stamp `CloseMonthDate` → **ล็อคงวด** |

```
proposal_for_cal (จาก CDR approve)
   │
   ▼ Step 1: sp_sel_rebate_monthend ──► dbo.Agreement ──► Export SAP Agreement (xlsx)
   │                                        │
   ▼ Step 2: CreateRebateAsync ◄────────────┘ ──► SAP ERP
   │
   ▼ Step 3: sp_sel_ar_dw (เฉพาะ AR*) ──► AR_DW + AR_DW_TYPE_Z ──► Export Accrued (xlsx, fiperiod > งวด)
   │
   ▼ Step 4: PUT /close-months ──► ล็อคงวด
```

**Export 2 ปุ่มอ่านจากไหน:** Export SAP Agreement ← `dbo.Agreement` ตรง ๆ · Export Accrued Sum ← view `View_Report3_AR` filter `fiperiod > งวดที่เลือก` (งวดบัญชีถัดไป — intended)

---

## 4. ปุ่มทั้ง 6 ปุ่ม

### กล่อง 1 — Generate SAP Agreement

| ปุ่ม | ทำอะไร | เปิดเมื่อ | กดซ้ำได้? |
|---|---|---|---|
| **Calculate** | คำนวณยอด Agreement ของงวด (job รัน SP `sp_sel_rebate_monthend`) → เสร็จ stamp step 1 | ยังไม่เคยคำนวณ + ยังไม่ส่ง SAP + ยังไม่ปิดเดือน | ❌ สำเร็จแล้ว**ล็อคถาวร** |
| **Export SAP Agreement** | ดาวน์โหลด `Rebate_Report_Month_End_{ts}.xlsx` | step 1 เสร็จ | ✔ |
| **Send to SAP** | confirm modal (**ย้อนกลับไม่ได้**) → ส่งข้อมูล Agreement เข้า SAP (job) → stamp step 2 | step 1 เสร็จ + ยังไม่เคยส่ง + ยังไม่ปิดเดือน | ❌ ครั้งเดียว |

ผล Calculate มี 3 แบบ: toast เขียว "คำนวณสำเร็จ" / toast เหลือง "คำนวณสำเร็จแต่ไม่มีข้อมูล" (งวดไม่มี proposal) / toast แดง fail

### กล่อง 2 — Calculate Accrued Accumulated Rebate

| ปุ่ม | ทำอะไร | เปิดเมื่อ | กดซ้ำได้? |
|---|---|---|---|
| **Calculate** | คำนวณ rebate สะสม (job รัน SP `sp_sel_ar_dw`) → stamp step 3 | **step 2 (ส่ง SAP) เสร็จแล้ว** + ยังไม่เคยทำ + ยังไม่ปิดเดือน | ❌ |
| **Export Accrued Sum.** | ดาวน์โหลด `Accrued_Rebate_{ts}.xlsx` — ข้อมูลเป็นของงวด**หลัง**งวดที่เลือก (`fiperiod > period` — intended ไม่ใช่ bug) | step 3 เสร็จ | ✔ |

### กล่อง 3 — Close Month

| ปุ่ม | ทำอะไร | เปิดเมื่อ | กดซ้ำได้? |
|---|---|---|---|
| **Mark End of Month** | confirm modal → stamp step 4 → **ล็อคงวด: สร้าง/submit proposal เดือนนั้นไม่ได้อีก** | step 2 **และ** step 3 เสร็จครบ | ❌ |

---

## 5. Role

| Role | ทำอะไรได้ |
|---|---|
| Finance / Admin / role อื่นที่เข้าเมนูได้ | ทุกปุ่ม |
| **Auditor (adt)** | **Export 2 ปุ่มเท่านั้น** — Calculate/Send/Close ถูก disabled |

⚠️ ข้อจำกัด adt enforce **ฝั่งหน้าจอเท่านั้น** — API ทุกเส้นเป็น authorize เปล่า (ดู Known issue #2)

---

## 6. เตรียมเทส

- User: fin (หรือ adm) + adt สำหรับเทส role
- งวดที่มี proposal Approved (ให้ Calculate มีข้อมูล) + งวดว่าง (เทส no-data)
- งวดที่มี proposal แบบ Accumulate (Type S มี section Accumulate) — ให้ Step 3 มีข้อมูล
- SQL ตรวจ state + output แต่ละ step:

```sql
-- State ทุก step ของงวด
SELECT Period, CalculateSAPDate, CalculateSAPBy, SendToSAPDate, SendToSAPBy,
       CalculateAccumulateDate, CalculateAccumulateBy, CloseMonthDate, CloseMonthBy, JobIdProcessing
FROM CloseMonths WHERE Period = 202607;

-- วัตถุดิบ: proposal ที่รอคำนวณของงวด
SELECT COUNT(*), COUNT(CASE WHEN drtype LIKE 'AR%' THEN 1 END) AS accrued_rows
FROM dbo.proposal_for_cal WHERE pyear = 2026 AND pmonth = 7;

-- Output Step 1
SELECT TOP 20 * FROM dbo.Agreement WHERE pyear = 2026 AND pmonth = 7 ORDER BY docno;

-- Output Step 3
SELECT TOP 20 * FROM dbo.AR_DW WHERE pyear = 2026 AND pmonth = 7;
```

---

## 7. Test Cases

### TC-01 · ยังไม่เลือกงวด = ทุกปุ่มปิด
**Steps:** เปิดหน้า ไม่เลือกปี/เดือน
**Expected:** ทั้ง 6 ปุ่ม disabled; stepper ไม่มีสถานะ

### TC-02 · ลำดับปุ่มเริ่มต้น (งวดใหม่)
**Steps:** เลือกงวดที่ยังไม่เคยทำอะไร
**Expected:** เปิดเฉพาะ **Calculate (Agreement)**; อีก 5 ปุ่ม disabled

### TC-03 · Calculate Agreement สำเร็จ
**Steps:** กด Calculate → รอ job จบ
**Expected:** ปุ่มหมุนระหว่างรอ → toast success → stepper step 1 เขียว + ชื่อ user + เวลา → Export Agreement กับ Send to SAP เปิด → **Calculate ล็อค** (กดซ้ำไม่ได้); DB: `CalculateSAPDate` มีค่า + มีแถวใหม่ใน `dbo.Agreement` งวดนั้น (SQL §6)

### TC-04 · งวดไม่มีข้อมูล
**Steps:** Calculate งวดที่ไม่มี proposal
**Expected:** toast เหลือง "คำนวณสำเร็จแต่ไม่มีข้อมูล"; step 1 ยังเขียว (ถือว่าเสร็จ)

### TC-05 · Send to SAP
**Steps:** กด Send to SAP → confirm modal → ยืนยัน
**Expected:** modal เตือน irreversible ทั้ง TH/EN; job จบ → step 2 เขียว → **Send to SAP ล็อค**, Calculate (Accrued) เปิด; DB `SendToSAPDate` + `JobIdProcessing` เคลียร์หลังจบ

### TC-06 · Send to SAP ซ้อนกัน (dedup)
**Steps:** ระหว่าง job Send ยังวิ่ง เปิดอีก browser/user ยิงส่งงวดเดียวกัน
**Expected:** ไม่เกิด job ซ้ำ — ระบบคืน job เดิม (`existing_processing`); ข้อมูลไม่ส่งเบิ้ล

### TC-07 · Calculate Accrued ก่อนส่ง SAP ไม่ได้
**Steps:** งวดที่ step 1 เสร็จแต่ยังไม่ส่ง SAP → ดูปุ่ม Calculate (Accrued)
**Expected:** disabled จนกว่า step 2 เสร็จ

### TC-08 · Mark End of Month
**Steps:** ทำครบ step 1–3 → กด Mark End of Month → confirm
**Expected:** step 4 เขียว; ปุ่ม action ทุกตัวล็อค เหลือ Export 2 ปุ่ม; ไปหน้า Request สร้าง proposal งวดนั้น → ถูกบล็อค

### TC-09 · Export 2 ปุ่ม
**Steps:** Export Agreement หลัง step 1 / Export Accrued หลัง step 3 (รวมหลังปิดเดือน)
**Expected:** ได้ไฟล์ xlsx ทั้งคู่ กดซ้ำได้; **Accrued Sum = ข้อมูลงวดหลังงวดที่เลือก** (fiperiod > period) — อย่า log เป็น bug

### TC-10 · Role adt
**Steps:** login adt เปิดงวดที่ step 1+3 เสร็จ
**Expected:** กดได้เฉพาะ Export 2 ปุ่ม; Calculate/Send/Close disabled ทุกสถานะ

### TC-11 · เปลี่ยนงวดกลางคัน
**Steps:** งวด A ทำถึง step 2 → สลับ dropdown ไปงวด B (ว่าง) → สลับกลับ A
**Expected:** stepper + ปุ่ม refresh ตรงงวดที่เลือกเสมอ ไม่ปน state

### TC-12 · Job fail / SSE หลุด
**Steps:** จำลอง SP error หรือปิด network ระหว่าง job
**Expected:** toast error พร้อมข้อความ; ปุ่มกลับมากดได้ (ไม่ค้าง spinner); state DB ไม่ stamp

### TC-13 · Refresh หน้าระหว่าง job วิ่ง
**Steps:** กด Calculate → รีเฟรชหน้าทันที
**Expected:** job ฝั่ง server วิ่งต่อจนจบ (Hangfire); หน้าใหม่แสดง step ตาม DB เมื่อ job เสร็จ (กด refresh/เปลี่ยนงวดไปมา) — FE ไม่ resume SSE อัตโนมัติ = ไม่มี toast แจ้งผล ถือเป็น limitation

---

## 8. Known Issues / Limitations (อย่า log ซ้ำ)

| # | อาการ | สถานะ |
|---|---|---|
| 1 | **SSE `/rebates/calculate-agreement/jobs/{id}/events` ไม่มี authentication** (`.RequireAuthorization()` ถูก comment, TODO ใน code) | Security gap — แจ้ง dev |
| 2 | **Role gate อยู่ FE เท่านั้น** — BE ทุก endpoint (calculate/send/close/export) เป็น `RequireAuthorization()` เปล่า; adt หรือ role ใดก็ยิง API ตรงได้ | Security gap — แจ้ง dev/BA |
| 3 | **Send to SAP ใช้ HTTP GET แต่เปลี่ยนแปลงข้อมูล** (enqueue job + stamp) — เสี่ยงกับ prefetch/retry | Design smell |
| 4 | Calculate สำเร็จแล้วคำนวณซ้ำไม่ได้จากหน้าจอ — ข้อมูลผิดต้องแก้ DB (`CloseMonths.CalculateSAPDate = NULL`) | Limitation |
| 5 | Refresh ระหว่าง job = เสีย SSE ไม่มีแจ้งผล (job ยังวิ่ง) — ต้อง refresh เอง | Limitation |
| 6 | Export Accrued Sum = งวดหลังงวดที่เลือก (`fiperiod > period`) | **Intended** — business logic |
| 7 | Success indicator ภายใน SP สองตัวตรงข้ามกัน (Agreement `returnValue==0` = ok, Accrued `>0` = ok) — กระทบเฉพาะ dev | Code gotcha |

---

## 9. อ้างอิง Code (สำหรับ dev ตอน triage)

| ส่วน | ไฟล์ |
|---|---|
| FE หน้าจอ + gating ทุกปุ่ม | `features/rebate/components/RebatesWrapper.tsx` |
| FE hooks (agreement/accrued/close/step) | `features/rebate/hooks/useRebateReportAgreement.ts`, `useRebateReportReccured.ts`, `useCloseMonths.ts`, `useGetStepStatus.ts` |
| BE step status | `Features/Rebates/GetRebateSteps/GetRebateStepsQueryHandler.cs` |
| BE calculate agreement (job) | `Features/Rebates/CalculateAgreement/CalculateAgreementBackgroundEndpoint.cs` + `RebateMonthendJob.cs` |
| BE calculate accrued (job) | `Features/Rebates/CalculateAccruedSum/CalculateAccruedSumBackgroundEndpoint.cs` + `CalculateAccruedSumBackgroundJob.cs` |
| BE send to SAP | `Features/Report/SendToSAP/SendToSAPHandler.cs` (dedup `JobIdProcessing` → `CreateRebateAsync`) |
| BE export | `Features/Rebates/ExportAgreement/` + `ExportAccruedSum/` |
| BE close month | `Features/CloseMonths/Update/UpdateCloseMonthEndpoint.cs` |
| Feature doc | `.claude/docs/features/rebate.md` |
