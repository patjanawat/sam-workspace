# CR5 Review Meeting Summary

**Source:** `docs/[ACCxManao] CR5 Package - Review and Discussion.docx`
**Meeting date:** 2026-05-22, 06:04, 1h 10m 56s
**Recording owner:** Khemaporn Kim Phankam-Ai

## Participants

| Name | Role / Side |
|---|---|
| Eiamsakul, Raweewan (Art) | ACC — Business |
| Pangneewong, Warunee (Kade) | ACC — Lead |
| Kanhakanchana, Kanitnun (Nott) | ACC — Tech / Data |
| Vorapong Muay Saetang | ACC |
| Ket-udom, Kritsada | ACC |
| Anutida Aew Inta-orm | ACC |
| Pharsit Oh Chusuwan | Manao — PM |
| Itthirit Tae Merat | Manao — Tech |
| Khemaporn Kim Phankam-Ai | Manao — BA |
| Panawat Wat Atjanawat | Manao |
| Nantanat Nam Nantachai | Manao |

## CR Items Discussed (10 items + extra)

### ข้อ 1 — Net Freight per Customer

- เดิม: net-freight จับที่ระดับ Company (ACC/JCC) + Plant + Type ดึงค่าเฉลี่ย
- ใหม่: ต้องลึกถึง **Customer** เพราะบาง customer มารับเองที่โรงงาน (ไม่มี net-freight)
- Backend: Nott สร้าง view ใหม่แล้ว — Manao แค่เปลี่ยน table store ไปจับ view ใหม่
- **Join key:** Customer + SO2 + Product Code + Period
- **Constraint:** Sustaina group ต้อง **1:1** เท่านั้น (ถ้าใส่ >1 customer → จับไม่ได้)
- **Match rule:** เจอ 0 → ค่าเป็น 0, เจอ >1 → error
- Affect: Sales Manager + Pricing + Commercial Director views

### ข้อ 2 — Clone Proposal Type P (cross-month within year)

- ปัญหา: เมนู clone เห็นแค่ previous month (M-1) ทำให้ clone Type P (3-6 เดือน) ข้ามไม่ได้
- ใหม่: dropdown clone ต้องโชว์ proposal ย้อนหลังได้ภายใน **ปีเดียวกัน** (ห้ามข้ามปี ค.ศ./พ.ศ.)
- Scope: **Type P เท่านั้น** (Type S ไม่เกี่ยวเพราะรายเดือน)
- รวม proposal status `Terminated` ด้วย (เพราะ Terminate = modify period ให้สั้นลง = Modify flow)
- แก้แค่เงื่อนไข drop-down list — flow/field อื่นเหมือนเดิม (แก้ value_to, volume)

### ข้อ 3 — Add Customer Segment field

- เพิ่ม **Customer Segment** column ในกรอบ Customer ของ General Information page
- ดึง by Customer Code จาก data warehouse view (ของ Nott)
- ตำแหน่ง: ข้าง column ชื่อลูกค้า/จังหวัด
- 1 customer = 1 segment (no multi)
- Affect: ทุก page ที่ render proposal (ASM, Pricing, CD, Summary) — pages เหมือนกันหมด
- **Migration:** อัพเดท **ปี 2026** ทั้งหมดผ่านหลังบ้าน (mass update SQL) — ไม่ต้องเขียน migration program

### ข้อ 4 — Special Accumulate Rate (THB/Ton)

- **Type S only** — เพิ่ม block ใหม่ชื่อ **Special Accumulate Bath/Ton** ขนานกับ Accumulate Rate เดิม
- คำนวณ concept เดิม (Max-Max) — Nott แก้ stored proc + calculation
- ใช้ code: **AR3** (เดิมมี AR1, AR2)
- Affect:
  - Input page (Sale Rep)
  - Summary page ทุก approval level
  - Total Rebate / Pre-rebate calculation
  - Forecast หลังบ้าน
  - Export Excel column เพิ่ม (sumtracking — top report)
- **Historical (2026 ก่อนหน้า):** field เป็น **blank** (ไม่ set ค่า, ไม่ใช่ 0) — ไม่กระทบ rate base เก่าเพราะ calc แล้ว

### ข้อ 5 — Mass Upload Discount Adjustment ⚠️ ยังไม่จบ

- Use case: นโยบายลด discount 200 THB/ton ทั้งกระดาน — ไม่ให้ sale รายคน key เอง
- **Scope:** ทั้ง Type P + Type S (เลือกได้: เฉพาะ P / เฉพาะ S / ทั้งคู่)
- Input: period, product (ทุก product), discount adjustment, effective date range
- เป็น **new form** (ใหม่ทั้งหน้า), actor = **Sale Admin** (หลังบ้าน)
- Approve flow: ข้าม ASM → ไปที่ **Sale Division Manager** (เพราะ batch ทั้ง area) → Commercial Director
- Logic ความซับซ้อน 2 case:
  - **Case A (ง่าย):** มี version 0 ของเดือน active แล้ว → clone หลังบ้าน + update discount + sync SAP
  - **Case B (ยาก):** sale ยังไม่ key version 0 เดือนใหม่ + ต้องการ mass แทน → ไม่มี proposal number ตั้งต้น → ยังหา solution ไม่ออก (RPA?)
- ต้อง support ทั้ง **เพิ่ม** + **ลด** (negative adjust ไม่ได้ — ลงติดลบไม่ได้ ใช้ขั้นต่ำ 0)
- **TODO:** Art + Nott คุย requirement อีกรอบวันจันทร์ ส่งให้ Oh ต่อ

### ข้อ 6 — เคลียร์ (ไม่มี discussion)

### ข้อ 7 — Show Ex-Work Price (Sale Rep)

- เดิม Sale Rep เห็นแค่ Total Discount
- ใหม่: เพิ่ม field **Price Ex-Work per product** ใต้ Change column ใน **Summary page** (step สุดท้ายของ Sale Rep)
- Formula: `Price Ex-Work = Price List - Max Ex Rebate - Discount`
- Show เฉพาะ Sale Rep + SSM page (level บนเห็นอยู่แล้ว)
- Apply **ทั้ง Type S + Type P**

### ข้อ 8 — Remove Pricing Team from Approval Flow

- **Approval flow ใหม่:** Sale Rep → ASM → Sale Division Manager → Commercial Director (ตัด Pricing Team)
- SAP sync side: Pricing check ยังเหมือนเดิม (เอาออกแค่ approval flow)
- Manao เก็บ version เก่า (มี Pricing Team) ไว้ — เผื่อใช้

### ข้อ 9 — Delegate after Pricing Team removed

- Sale Division Manager **delegate ไปที่ Commercial Director** (เดิม pricing เป็น delegate target)
- Pricing Team ไม่อยู่ใน flow + ไม่อยู่ในลิสต์ delegate
- Function ตัว delegate ของ CD: **deactivate** ไว้ (เก็บ code ไม่ใช้)
- (Pangneewong: delegate ใช้น้อยมาก — ไม่เคยใช้)

### ข้อ 10 — Show "Pending With Who" column (Sale Rep view)

- หน้า Draft / Pending Approval ของ Sale Rep — ปัจจุบันไม่เห็นว่า proposal อยู่ที่ approver คนไหน
- เพิ่ม column แสดง **current approver** (level บนเห็นอยู่แล้ว, sale ไม่เห็น)

### Extra Item — Customer Relation Report

- **Bug:** Contact Number มีในหน้า PAM proposal แต่ไม่ export ออกใน report
- Oh ต้องไป check + fix
- Art ส่ง sample report ให้ Manao ดู

## Open Items / Action

| # | Owner | Action |
|---|---|---|
| ข้อ 5 | Art + Nott | คุย requirement detail วันจันทร์, ส่ง Oh ต่อ |
| Extra | Oh / IS | Check bug Contact Number not exporting |
| ข้อ 1 Test | QA | ระวัง test case ที่ใส่ customer >1 (จะ fail by design — 1:1 constraint) |
| ข้อ 9 Test | Art | ช่วย test delegate flow |

## Key Risks / Notes

- **Migration weight:** ข้อ 3 (Customer Segment) + ข้อ 4 (AR3) — backfill 2026 data, mass update หลังบ้าน
- **ข้อ 5 unresolved** — เคสยังไม่มี version 0 ตอน mass = blocker, ยังไม่มี solution
- ข้อ 1 / 4: stored proc + Nott view ต้อง coordinate timing migration
- Pricing Team removal (ข้อ 8) กระทบหลาย touchpoint — Oh: "แก้เยอะแน่นอน"

## Effort Estimate Summary (CR1–CR9)

Per impact analysis docs (`docs/CR{n}-impact-analysis.md`). Unit = man-days. Calendar = parallel BE/FE.

### Per-CR breakdown

| CR | Title | BE | FE | Tests | Review + QA + UAT | Coord / Other | **Total** | Source |
|---|---|---:|---:|---:|---:|---:|---:|---|
| CR1 | Net Freight per Customer | 7.5 | 6.5 | (in BE+FE) | 16.5 (review 1.5 + QA 9 + SIT 6 + UAT 1.5) | — | **~32** | `CR1-net-freight.md` + delta in `CR1-impact-analysis.md` (BE −2d, Nott view done) |
| CR2 | Clone Type P (cross-month) | 0.5 | 0.5 | 1.0 | 1.5 | — | **~3.5** | `CR2-impact-analysis.md` (narrowed from 7.5d spec) |
| CR3 | Add Customer Segment | 1.6 | 2.5 | (in BE+FE) | 1.5 | — | **~5.6** | `CR3-impact-analysis.md` |
| CR4 | Special Accumulate Rate (AR3) | 3.2 | 3.0 | (in BE+FE) | 1.5 | 1.5 (SP coord + SAP team) | **~8.75** | `CR4-impact-analysis.md` (excl. Nott SP work) |
| CR5 | Mass Upload Discount Adjustment | TBD | TBD | TBD | TBD | TBD | **TBD** ⚠️ | Unresolved — Art + Nott คุยจันทร์, ส่ง Oh |
| CR6 | (cleared in meeting) | — | — | — | — | — | **0** | — |
| CR7 | Show Ex-Work Price (Sale Rep) | 1.6 | 2.1 | (in BE+FE) | 1.0 | — | **~4.7** | `CR7-impact-analysis.md` |
| CR8 | Remove Pricing Team from Flow | 4.3 | 1.3 | (in BE+FE) | 2.0 | 0.3 (coord CR9) | **~7.9** | `CR8-impact-analysis.md` |
| CR9 | Delegate (post-PTE removal) | 1.9 | 0.9 | (in BE+FE) | 0.7 | — | **~3.5** (bundled w/ CR8) | `CR9-impact-analysis.md` |
| Extra | Customer Relation Report bug | 0.5 | — | 0.2 | 0.3 | — | **~1** (rough — pending Oh check) | `CR5-review-meeting-summary.md` Extra |

### Totals

| Group | Man-days |
|---|---|
| CR1 (largest, DW + 4-part key migration) | ~32 |
| CR2 + CR3 + CR4 + CR7 (feature additions) | ~22.55 |
| CR8 + CR9 (flow refactor — bundled) | ~11.4 (8.0 if delta only) |
| Extra report bug | ~1 |
| **Subtotal (CR1–9 excl. CR5)** | **~67** |
| CR5 (Mass Upload) — TBD | **+5..15 est.** (gut feel based on Case A/B split) |
| **Grand total estimate** | **~72..82 man-days** |

### Calendar (parallel BE + FE + QA)

| Phase | Duration |
|---|---|
| CR1 standalone (DW coord blocker) | **~5 weeks** |
| CR2 + CR3 + CR7 (small, parallelize) | ~1.5 weeks |
| CR4 (AR3 — needs Nott SP) | ~2 weeks |
| CR8 + CR9 (bundle) | ~2 weeks |
| CR5 (after Monday clarification) | **TBD** |
| Extra bug | ~2 d |
| **Total calendar (sequential where blocked, parallel where possible)** | **~10–12 weeks** |

### Notes

- Estimates exclude **Nott stored proc work** (CR1 view, CR4 AR3 calc proc) — separate ACC-internal track
- CR1 effort = spec doc baseline; meeting reduces BE by ~2 days (Nott view already built)
- CR8 + CR9 **must** ship together — bundle saves coordination overhead
- CR5 is **highest variance** — Case B (no v0 ตั้งต้น) unsolved → effort uncertain
- All estimates **±20–30%** confidence — pin SHA + finalize specs before commit
