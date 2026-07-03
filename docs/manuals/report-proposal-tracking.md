# QA Manual — หน้า Report: รายการคำขออนุมัติ / Proposal Tracking (`/report/proposal-tracking`)

> เวอร์ชัน: 2026-07-03 · อ้างอิง code: SAM repo branch `develop` @ `356bd3fd`
> ครอบคลุม: หน้า filter + การ export Excel + เนื้อหาไฟล์รายงาน + การ scope ข้อมูลตาม role

---

## 1. หน้านี้ทำอะไร

หน้า **export รายงาน Excel** ติดตามคำขออนุมัติทั้งหมด — **ไม่มีตารางข้อมูลบนจอ** มีเฉพาะ:

- Filter 6 ตัว (multi-select ทั้งหมด): เลของค์กร / เขตการขาย / จังหวัด / กลุ่ม Proposal / เดือน / ปี
- ปุ่ม **Export** → ดาวน์โหลดไฟล์ `PAM_Tracking_{org|all}_{YYYYMMDD}.xlsx`

ไม่เลือก filter ใดเลย = export ทั้งหมด (ภายใต้ scope ของ role — ดู §3)

---

## 2. พฤติกรรมหน้าจอ (FE)

| พฤติกรรม | Expected |
|---|---|
| เปลี่ยนค่า **Sales Org** | ค่า **Sales Office** ที่เลือกไว้ถูกล้างเป็นว่าง |
| เปลี่ยนค่า **Sales Office** | ค่า **Province** ที่เลือกไว้ถูกล้างเป็นว่าง |
| ตัวเลือก Province | กรองตาม Sales Office ที่เลือก; ไม่เลือก office = เห็นทุกจังหวัด (ตาม scope role) |
| ระหว่างดาวน์โหลด | ปุ่ม Export ขึ้น spinner, filter ทุกตัว disabled |
| ดาวน์โหลดสำเร็จ | toast "ดาวน์โหลดไฟล์สำเร็จ / Download successful" |
| ดาวน์โหลดพลาด | toast "ดาวน์โหลดไฟล์ไม่สำเร็จ / Download failed" |

ที่มา dropdown:
- Sales Org + Proposal Group ← options ชุดเดียวกับหน้า Customer Group
- Sales Office + Province ← `GET /report/proposal-tracking-option` (scope ตาม role — ดู Known issue #1)
- เดือน/ปี ← สร้างฝั่ง FE (เดือน 1–12, ปีย้อนหลัง/ปัจจุบันตาม util กลาง)

---

## 3. การ Scope ข้อมูลตาม Role (สำคัญ)

Endpoint เป็น `[Authorize]` เปล่า — **ทุก role เข้าได้** แต่ข้อมูลถูกกรอง:

| Role | เห็นข้อมูล |
|---|---|
| Sale Rep (srp) | proposal ของตัวเอง + ของ user ที่ report ตรงถึงตัวเอง |
| Area Sales Manager (sam) | ของตัวเอง + ลูกทีม direct (ReportTo = ตัวเอง) |
| SDM / Pricing / CDR / Finance / Auditor / Admin | **ทั้งบริษัท** (ไม่มี filter) |

เงื่อนไขทางเทคนิค: BE ดูจาก field บน user — มี `SaleGroupCode` (= srp) หรือ `SaleOfficeCode` (= sam) → กรอง; ไม่มีทั้งคู่ → ไม่กรอง

**สถานะที่เข้า report:** ทุกสถานะ ยกเว้น **Temp** — Draft / Pending / Approved / Rejected เข้าหมด

---

## 4. โครงสร้างไฟล์ Excel

Sheet เดียวชื่อ "Proposal Tracking", header ฟ้า, 37 columns

### 4.1 Grain ของแถว (ต้องเข้าใจก่อนนับแถว)

**1 แถว = ลูกค้า 1 ราย × rate row 1 แถว** (ทุก rate type × ทุก tier × ทุกหน้า)

- Proposal มี 5 ลูกค้า × 20 rate rows → **100 แถว** (ข้อมูลหัว proposal ซ้ำทุกแถว)
- **ไม่มีกฎ last-page/max-rate** แบบหน้า approval — dump ดิบทุกแถวจาก DB
- Type R/S มาจากตาราง `ProposalProductTypeRS`; Type P จาก `ProposalProductTypeP` — ต่อท้ายกันในไฟล์เดียว

### 4.2 Column ทั้ง 37 + แหล่งที่มา

| # | Column | Source / สูตร |
|---|---|---|
| 1–2 | Year, Month | `Proposals.Year / .Month` |
| 3 | Sales org Code | `Proposals.SaleOrgCode` |
| 4–5 | Customer code / Name | `ProposalCustomers.SOLDTO_CODE / SOLDTO_NAME` |
| 6–7 | Sales Office Code / Name | `Proposals.SaleOfficeCode` + ชื่อ EN (fallback TH) |
| 8 | Sales rep. code | `Users.SaleGroupCode` ของ Sale เจ้าของ (คือ sale group ไม่ใช่ user id) |
| 9 | Sales rep. Name | ชื่อ Sale เจ้าของ proposal |
| 10 | Province | `Proposals.RegionName` |
| 11–12 | Product Code / Name | rate row (`PRODUCT_CODE / PRODUCT_NAME`) |
| 13 | Bag / Bulk | `PRD_GRP_EN_NM` (product group) |
| 14 | Proposal group | hardcode: Type R/S = "Normal", Type P = "Project" |
| 15 | Type Proposal | R → "Region", S → "Special", P → "Project" |
| 16 | Contract Number | `CONTRACT` (ใช้จริงกับ Type P) |
| 17 | Project Name | `Proposals.ProjectName` (Type P) |
| 18 | Ship to Code | `SHIP_TO` |
| 19–20 | Start / End date | `FROM_DATE / TO_DATE` ของ rate row (`yyyy-MM-dd`) |
| 21 | D/R type | รหัส `RATE_TYPE` ดิบ: Discount, NR1, SR1, FR1, SR3, SR2, AR1, SR4, AR2 |
| 22 | D/R Name | ชื่อเต็ม เช่น NR1 → "Normal Rebate" |
| 23 | Target Sum. | R/S: `TARGET` → "True"/"False" (รวมเป้า); P: ว่าง |
| 24 | Created by | ชื่อ Sale |
| 25 | Created date | `RequestDateUTC` **+7 ชม.** |
| 26 | CD Approve Date | `ApprovalDateUTC` **+7 ชม.** (ว่างถ้ายังไม่ approved) |
| 27 | Method | 1 = "ตั้งแต่ตันแรก / No minimum", 2 = "ขั้นบันได / Tiered", อื่น = "โควตา / Quota"; P: ว่าง |
| 28 | Target Proposal | "Target {TIER_NO}"; P: ว่าง |
| 29 | Quantity | "{FROM_QTY} - {TO_QTY}"; P: ว่าง |
| 30 | Rate (THB/T) | `RATE` — ทุก rate type **ยกเว้น** SR4/AR2 |
| 31 | Amount (THB) | `RATE` — เฉพาะ SR4/AR2 (Special Additional / Accumulate แบบจำนวนเงิน, Type S) |
| 32 | Proposal no. | `Proposals.RequestNo` |
| 33 | Version | `Proposals.Version` |
| 34 | Customer Group Code | `Proposals.CustomerGroupCode` |
| 35 | Period | `"{Year}{Month}"` — **ไม่ pad zero** (ก.ค. 2026 = "20267") ดู Known issue #2 |
| 36 | Status | ชื่อสถานะ: Draft / Pending / Approved / Rejected |
| 37 | Step | ขั้นที่กำลังรอ — ดู §4.3 |

### 4.3 Logic column "Step"

| สถานะ | ผู้ approve ล่าสุด | Step ที่แสดง |
|---|---|---|
| Draft | — | (ว่าง) |
| Pending | ยังไม่มี | ASM |
| Pending | SRP (submit) | ASM |
| Pending | ASM | SDM |
| Pending | SDM | PT |
| Pending | PT | CD |
| Approved | — | CD |
| Rejected | role ใดก็ตาม | ตัวย่อ role ที่กด reject |

ความหมาย: **Pending = "รอใครอยู่"** / Rejected = "ตายที่ขั้นไหน"

---

## 5. Test Cases

### TC-01 · Export ไม่เลือก filter
**Steps:** เปิดหน้า → กด Export ทันที
**Expected:** ได้ไฟล์ครบทุก proposal ใน scope role (ยกเว้น Temp); ชื่อไฟล์ `PAM_Tracking_all_{วันนี้}.xlsx`

### TC-02 · Filter แต่ละตัวทำงาน
**Steps:** เลือกทีละ filter (org / office / province / group / month / year) → Export → เปิดไฟล์ตรวจ
**Expected:** ทุกแถวในไฟล์ตรงเงื่อนไข; filter หลายค่าพร้อมกัน = OR ภายใน filter เดียวกัน, AND ระหว่าง filter

### TC-03 · เลือกทั้งหมด (Select All) vs ไม่เลือก
**Steps:** export แบบไม่เลือกอะไร vs แบบกด "เลือกทั้งหมด" ทุก filter
**Expected:** จำนวนแถว**เท่ากัน** — ถ้าไม่เท่าให้เช็ค query string ใน network tab (sentinel `-1` อาจหลุดไป BE)

### TC-04 · Cascade clear
**Steps:** เลือก Office + Province → เปลี่ยน Sales Org
**Expected:** Office ถูกล้าง → Province ถูกล้างตาม; ตัวเลือก Province เปลี่ยนตาม office ใหม่

### TC-05 · Grain แถวถูกต้อง
**Steps:** สร้าง proposal R: 2 ลูกค้า, 1 product, Normal Rebate 2 tiers + Discount → export
**Expected:** ได้ 2 ลูกค้า × 3 rate rows = **6 แถว**; ข้อมูลหัว (Proposal no., Customer) ซ้ำถูกต้องทุกแถว

### TC-06 · แถว multi-page มาครบ
**Steps:** proposal ที่มี 2 หน้า rate ต่างกัน → export
**Expected:** rate rows ของ**ทั้งสองหน้า**อยู่ในไฟล์ (ไม่ยุบเหลือหน้าสุดท้ายแบบหน้า approval)

### TC-07 · Role scoping
| ผู้ export | Expected |
|---|---|
| srp | เห็นเฉพาะ proposal ตัวเอง |
| sam | ตัวเอง + ลูกทีม direct; **ไม่เห็น**ทีมอื่น |
| sdm / pte / cdr / fin / adt / adm | เห็นทุก proposal |

### TC-08 · สถานะครบ ยกเว้น Temp
**Steps:** เตรียม proposal ทุกสถานะ (Temp คือสร้างค้างไม่กรอกอะไร) → export
**Expected:** Draft / Pending / Approved / Rejected อยู่ในไฟล์; **Temp ไม่อยู่**

### TC-09 · Column Step ทุกกรณี
**Steps:** เตรียม proposal: Draft, Pending (ยังไม่ approve), Pending (ASM approved), Pending (SDM approved), Pending (PT approved), Approved, Rejected ที่ SDM → export
**Expected:** Step = ว่าง / ASM / SDM / PT / CD / CD / SDM ตามลำดับ (ตาราง §4.3)

### TC-10 · Rate vs Amount column (Type S)
**Steps:** สร้าง Type S มี Special Additional ทั้งแบบ THB/ton (SR2) และแบบ Amount (SR4) → export
**Expected:** SR2 → ค่าอยู่ "Rate (THB/T)", "Amount (THB)" ว่าง; SR4 → กลับกัน

### TC-11 · Type P
**Steps:** export proposal Type P
**Expected:** Proposal group = "Project", Type Proposal = "Project"; Contract/Project Name/Ship to มีค่า; Method / Target Proposal / Quantity / Target Sum. **ว่าง**

### TC-12 · วันที่ timezone
**Steps:** submit proposal เวลาไทยที่ทราบแน่ → export
**Expected:** Created date = เวลาไทย (UTC+7) ตรงกับหน้าจอ approval; CD Approve Date ว่างจนกว่า CDR approve

### TC-13 · ดาวน์โหลดพลาด
**Steps:** ตัด network / ทำ session หมดอายุ → Export
**Expected:** toast error; ปุ่มกลับมากดได้ ไม่ค้าง spinner

---

## 6. Known Issues / Limitations (อย่า log ซ้ำ)

| # | อาการ | สถานะ |
|---|---|---|
| 1 | **Dropdown จังหวัดของ ASM ไม่ถูกกรอง** — BE คำนวณ region ของ office ตัวเองแล้วไม่ได้ใช้ (dead code ใน `ProposalTrackingOptionHandler`) → ASM เห็นทุกจังหวัดใน dropdown (ข้อมูลจริงยังถูก scope ที่ตัว report) | Bug จริง — ควรแจ้ง dev |
| 2 | **Period ไม่ pad zero**: `{Year}{Month}` → ก.ค. = "20267" (ควร "202607") — sort/filter ใน Excel เพี้ยน | Bug/format — ควรแจ้ง dev |
| 3 | ไม่มี paging — data มาก = ช้า, ไฟล์ใหญ่, memory ฝั่ง server ทั้งก้อน | Limitation |
| 4 | แถวซ้ำตาม grain ลูกค้า × rate row — ไฟล์บวมเร็วเมื่อ proposal มีลูกค้าเยอะ | By design |
| 5 | ชื่อไฟล์ BE (`Proposal_Tracking_*`) กับชื่อที่ FE ตั้ง (`PAM_Tracking_*`) คนละชื่อ — FE เป็นตัวชนะตอน save | By design |

---

## 7. อ้างอิง Code (สำหรับ dev ตอน triage)

| ส่วน | ไฟล์ |
|---|---|
| FE หน้าจอ + filter + export | `features/report/components/ReportProposalTrackingWrapper.tsx` |
| FE hooks | `features/report/hooks/useReportPropasalTracking.ts` |
| BE endpoint | `Features/Report/ProposalTracking/ProposalTrackingEndpoint.cs` |
| BE query + Excel | `Features/Report/ProposalTracking/ProposalTrackingHandler.cs` |
| BE dropdown options | `Features/Report/ProposalTrackingOption/ProposalTrackingOptionHandler.cs` |
| Logic column Step | `Features/Approval/Shared/ConvertRole.cs` → `GetProposalTrackingStep` |
| รหัส rate type | `Shared/Constants/RateType.cs` |
