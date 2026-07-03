# QA Manual — หน้า Approval Detail: ตาราง "รายละเอียด / Details" (Tab ภาพรวม / Overview)

> เวอร์ชัน: 2026-07-03 · อ้างอิง code: SAM repo branch `develop` @ `2de3ba9b` (รวม SAM-1810, SAM-1762/CR5.1 Net Freight ราย sold-to, SAM-1828)
> ครอบคลุม: การแสดงผลและการคำนวณของตาราง Details บนหน้า `/approval/{id}` ทุก Proposal Type (R / S / P) ทุก role ที่เกี่ยวข้อง

---

## 1. ขอบเขต

ตรวจสอบว่าตาราง "รายละเอียด / Details" บนหน้ารายละเอียดคำขออนุมัติ:

1. แสดง **column ถูกชุด** ตาม role ผู้ใช้ × ประเภท proposal
2. แสดง **ค่าถูกต้อง** ตามกฎการเลือกค่า (last page / max rate) และสูตรคำนวณ
3. เทียบ **เดือนก่อน (PM)** ถูกตัว ถูกสูตร
4. **Net Freight** แสดงค่า snapshot ที่ถูกต้อง
5. **สิทธิ์เข้าถึง** endpoint ถูกต้องตาม role

ไม่ครอบคลุม: การ approve/reject, stepper, tab สรุปคำขอ / Summary

---

## 2. ความรู้พื้นฐานก่อนเทส (สำคัญ — อ่านก่อน)

### 2.1 ตัวเลขทั้งหมดคำนวณฝั่ง Backend				

FE ไม่คำนวณอะไรเลย — BE ส่งค่า format สำเร็จ (คั่น comma, **ตัดทศนิยมทิ้งเป็นจำนวนเต็ม**) ผ่าน:

- Role ASM (sam) → `GET /approval/sam/{id}`
- Role อื่นทั้งหมด (SDM / Pricing / CDR) → `GET /approval/sdm/{id}`

### 2.2 กฎการเลือกค่า rate (Type R และ S)

ต่อ (สินค้า, ประเภท rate):

```
1. หา "หน้าสุดท้าย" ที่มีข้อมูล (max PAGE)
2. บนหน้านั้น เอาค่า rate สูงสุด (max RATE ของทุก tier ในหน้า)
3. ตัดทศนิยม (5.9 → 5)
```

**ผลเทส:** แก้ rate บนหน้าแรกโดยที่มีหน้าสองอยู่ → ตารางต้อง**ไม่เปลี่ยน** (ใช้หน้าสุดท้ายเท่านั้น)

### 2.3 ค่าเดือนก่อน (PM = Previous Month)

- มาจาก proposal **ฉบับก่อนหน้า 1 ระดับ** (ฉบับที่ถูก clone มา — `PreviousId`) ไม่ใช่ "เดือนก่อนตามปฏิทิน"
- Type R/S: จับคู่ด้วย **รหัสสินค้า** — สินค้าที่ไม่มีในฉบับก่อน → PM = 0
- Type P: จับคู่ด้วย **รหัสสินค้า + Ship To + เลขหน้าเดียวกัน**
- คำขอที่สร้างใหม่ (ไม่ได้ clone) → PM = 0 ทุกช่อง

### 2.4 Net Freight = ค่า snapshot (ราย sold-to — SAM-1762/CR5.1)

- ไม่ใช่ค่าที่ Sale กรอก — ระบบดึงจากตาราง `warehouse.Subsidy` (sync จาก SAP/ACCDW view `View_SAM_FreightSubsidy_bySoldto`) **ณ วินาทีที่ Sale กด save rebate**
- Match แบบเป๊ะ 4 key: **SaleOrg + ลูกค้า (sold-to) + สินค้า + งวดของ proposal** (`period = ปี*100+เดือน`) — **ไม่มี fallback**; ไม่ match = 0 (proposal save ได้ปกติ)
- Proposal หลาย sold-to → ใช้ `SOLDTO_CODE` **ตัวแรก** (distinct + เรียง) ตัวเดียว
- Sync subsidy ใหม่หลัง save → หน้า approval **ต้องไม่เปลี่ยน** (จนกว่า Sale จะกลับไป save detail อีกรอบ)
- Subsidy ซ้ำ key เดียวกันใน master → save rebate โดน block พร้อมข้อความ "ข้อมูล Net Freight ไม่ถูกต้อง..." (guard `EnsureNoDuplicateNetFreightAsync`)

---

## 3. การเตรียม Test Data

| ชุดข้อมูล                                                           | วิธีเตรียม                                                                                     | ใช้เทส  |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------- |
| Proposal Type R หลาย product หลาย rate section                       | สร้างผ่านหน้า Request (srp/sam) กรอก Discount + Normal/Special/Freight Rebate + Loyalty | TC-02, 03, 04 |
| Proposal R หลายหน้า (Add New Page) rate ต่างกันต่อหน้า | ในหน้า rebate กด Add New Page แล้วใส่ rate ชุดใหม่                                 | TC-04         |
| Clone chain v0 → v1 (approve v0 ก่อน แล้ว clone)                    | Copy from existing บนหน้า Request                                                                  | TC-05, 06, 07 |
| Proposal ใหม่ ไม่มี previous                                        | สร้างใหม่ตรง ๆ                                                                              | TC-08         |
| Proposal Type S (มี Special Additional + Accumulate)                       | สร้าง Type S                                                                                        | TC-09         |
| Proposal Type P (มี Ship To หลายค่า หลายหน้า)               | สร้าง Type P                                                                                        | TC-10, 11     |
| User ครบ role: sam, sdm, pte, cdr, fin, adt, adm                          | ผูก ReportTo: srp → sam ที่ใช้เทส                                                           | TC-01, 12     |

### SQL ตรวจค่าดิบ (หลัง save rebate)

```sql
-- Type R/S: ดู rate ราย product/type/page
SELECT PRODUCT_CODE, RATE_TYPE, PAGE, TIER_NO, RATE, SUBSIDY, PRICE_LIST
FROM dbo.ProposalProductTypeRS
WHERE PROPOSAL_ID = '<proposal-guid>'
ORDER BY PRODUCT_CODE, RATE_TYPE, PAGE, TIER_NO;

-- Type P
SELECT PRODUCT_CODE, SHIP_TO, PAGE, RATE, SUBSIDY, PRICE_LIST
FROM dbo.ProposalProductTypeP
WHERE PROPOSAL_ID = '<proposal-guid>'
ORDER BY PRODUCT_CODE, SHIP_TO, PAGE;

-- Subsidy master (Net Freight ต้นทาง) — match ราย sold-to + งวด (SAM-1762)
SELECT PERIOD, ORGNO, CUS_SOL_CODE, PRODUCT_CODE, FREIGHT_SUBSIDY_BT
FROM warehouse.Subsidy
WHERE PRODUCT_CODE = '<product>' AND ORGNO = '<sale-org เช่น S854>'
  AND CUS_SOL_CODE = '<sold-to แรกของ proposal>' AND PERIOD = 202607;
```

รหัส `RATE_TYPE`: `Discount` = ส่วนลด · `NR1` = Normal Rebate · `SR1` = Special Rebate · `FR1` = Freight Rebate · `SR3` = Loyalty Program · (`SR2`/`AR1`/`SR4`/`AR2` = Special Additional/Accumulate — **ต้องไม่โผล่ในตารางนี้**)

---

## 4. Column ที่ต้องเห็น ต่อ Role × Type

### 4.1 Role ASM (sam)

| Type R                               | Type S                      | Type P       |
| ------------------------------------ | --------------------------- | ------------ |
| No.                                  | No.                         | No.          |
| Product Code                         | Product Code                | Product Code |
| Product Name                         | Product Name                | Product Name |
| Price List                           | Price List                  | Ship To      |
| Disc.                                | Disc.                       | Price List   |
| Nor. Reb.                            | Nor. Reb.                   | Net Freight  |
| Spec. Reb.                           | Spec. Reb.                  | Tot. Disc.   |
| Frei. Reb.                           | Frei. Reb.                  | PM. Disc.    |
| Net Freight                          | Spec. Add.                  | vs PM. Disc. |
| Lyt. Prog.                           | Accum. Reb.                 |              |
| Tot. Disc./Reb. (พื้นเขียว) | Net Freight                 |              |
| PM. Disc./Reb. (พื้นเทา)      | Lyt. Prog.                  |              |
| vs PM. Disc. (หัวดำ)            | Tot. Disc./Reb.             |              |
| vs PM. Reb. (หัวดำ)             | PM. Disc./Reb. + vs PM. ×2 |              |

### 4.2 Role SDM / Pricing / CDR (ชุดขยาย)

Type R/S: No., Product Code/Name, Price List, Disc., **Tot. Reb., Price EXW**, Net Freight, **UCM Price**, Tot. Disc./Reb., PM. Disc./Reb., vs PM. Disc., vs PM. Reb., **Tot. Disc./Reb. % vs Price List, Var-Cost, Comm. Margin**

Type P: No., Product Code/Name, Ship To, Price List, **Price EXW**, Net Freight, **UCM Price**, Tot. Disc., PM. Disc., vs PM. Disc., **Tot. Disc. % vs Price List, Var-Cost, Comm. Margin**

---

## 5. สูตรที่ต้อง Verify

| ช่อง                            | สูตร                                                        | หมายเหตุ                                |
| ----------------------------------- | --------------------------------------------------------------- | ----------------------------------------------- |
| Disc. / Nor. / Spec. / Frei. / Lyt. | ค่าตามกฎ §2.2 ต่อประเภท                       | เทียบ SQL ข้อ 3                         |
| Net Freight                         | `SUBSIDY` ตรง ๆ                                           | ไม่เข้าสูตรรวมใด ๆ             |
| Tot. Disc./Reb.                     | Disc + Nor + Spec + Frei + Lyt                                  | **ไม่รวม Net Freight**              |
| PM. Disc./Reb.                      | สูตรเดียวกัน คิดจาก proposal ฉบับก่อน | สินค้าไม่มีในฉบับก่อน → 0 |
| vs PM. Disc.                        | Disc (ปัจจุบัน) − Disc (ฉบับก่อน)              | ติดลบได้                                |
| vs PM. Reb.                         | (Nor+Spec+Frei+Lyt) ปัจจุบัน − ฉบับก่อน        | **ไม่รวม Disc.**                    |
| Tot. Disc. (Type P)                 | max RATE ในกลุ่ม (สินค้า, Ship To, หน้า)       | ก้อนเดียว ไม่มี breakdown         |

---

## 6. Test Cases

### TC-01 · Column ถูกชุดตาม role × type

**Steps:** login ทีละ role (sam → sdm → pte → cdr) เปิด proposal เดียวกัน ทำซ้ำทั้ง Type R, S, P
**Expected:** column ตรงตาราง §4 เป๊ะ ทั้งรายการและลำดับ; sdm/pte/cdr เห็นชุดเดียวกัน

### TC-02 · ค่า rate ตรงข้อมูลดิบ (Type R หน้าเดียว)

**Steps:** สร้าง R 2 products, กรอก Disc=1, Nor=3 (product 1) / Disc=2, Nor=3 (product 2), submit, เปิดหน้า approval ด้วย sam
**Expected:** ค่าตรงที่กรอก; Tot. Disc./Reb. = 4 และ 5; ช่องที่ไม่กรอก = 0

### TC-03 · Tot. Disc./Reb. ไม่รวม Net Freight

**Steps:** เลือกสินค้าที่มี subsidy ≠ 0 (เช็คด้วย SQL §3), กรอก Disc + rebate, ดู Tot.
**Expected:** Tot. = ผลบวก 5 ช่อง rate เท่านั้น; Net Freight โชว์แยก ไม่ถูกบวก

### TC-04 · กฎ last page + max rate

**Steps:** สร้าง R, section Normal Rebate หน้า 1 ใส่ tier 10/20, กด Add New Page หน้า 2 ใส่ tier 5/8
**Expected:** Nor. Reb. = **8** (หน้าสุดท้าย แม้ค่าต่ำกว่าหน้าแรก — ไม่ใช่ 20); แก้หน้า 1 เป็น 99 → ยังคง 8

### TC-05 · PM columns (มี previous)

**Steps:** approve v0 (Disc=1, Nor=3) → clone เป็น v1 แก้ Disc=2 → submit → เปิด approval v1
**Expected:** PM. Disc./Reb. = 4 (ของ v0); vs PM. Disc. = 1; vs PM. Reb. = 0

### TC-06 · vs PM ติดลบ

**Steps:** clone แล้ว **ลด** rate ต่ำกว่าฉบับก่อน
**Expected:** vs PM แสดงค่าติดลบ (มีเครื่องหมาย −) ไม่ใช่ 0 หรือ error

### TC-07 · สินค้าใหม่ที่ไม่มีในฉบับก่อน

**Steps:** clone แล้วเพิ่มสินค้าใหม่เข้า customer group
**Expected:** แถวสินค้าใหม่: PM = 0, vs PM = ค่าปัจจุบันทั้งก้อน; สินค้าเดิมไม่กระทบ

### TC-08 · Proposal สร้างใหม่ (ไม่มี previous)

**Expected:** PM. Disc./Reb. = 0 ทุกแถว; vs PM = ค่าปัจจุบัน; ไม่มี error

### TC-09 · Type S — Special Additional / Accumulate แยกส่วน

**Steps:** สร้าง S กรอกครบทุก section รวม Special Additional (THB/ton + Amount) และ Accumulate
**Expected:** ตารางหลักมี column Spec. Add. + Accum. Reb. (ราย THB/ton) ตาม §4.1; ก้อน Amount (บาท) แสดงเป็น **card แยกใต้ตาราง** ไม่ปนใน column rate; rate type SR2/AR1/SR4/AR2 ไม่ทำให้ค่า Nor/Spec/Frei เพี้ยน

### TC-10 · Type P — แถวราย (สินค้า × Ship To × หน้า)

**Steps:** สร้าง P สินค้าเดียว 2 Ship To, 2 หน้า
**Expected:** เห็น **ทุกหน้าเป็นคนละแถว** (ไม่ยุบเหลือหน้าสุดท้ายแบบ R/S); เรียง product → Ship To → หน้า

### TC-11 · Type P — PM จับคู่เลขหน้าเดียวกัน

**Steps:** approve P v0 (2 หน้า) → clone v1 → เปิด approval v1
**Expected:** PM. Disc. ของแต่ละแถว = RATE ของ v0 บน (สินค้า, Ship To, เลขหน้า) เดียวกัน
**⚠️ Known limitation:** ถ้า v0 มีเลขหน้าไม่ต่อเนื่อง (เคยลบหน้า) → PM = 0 — เป็น behavior ปัจจุบัน อย่า log เป็น bug ใหม่ (ดู §7)

### TC-12 · สิทธิ์เข้าถึง

| ผู้ใช้                                        | เปิด proposal ของ                  | Expected                                                                  |
| --------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------- |
| sam (manager ตรงของ srp เจ้าของ)       | ลูกทีม                              | เห็นข้อมูลปกติ                                              |
| sam ทีมอื่น                                  | ข้ามทีม                            | **403 Forbidden**                                                   |
| sam                                                 | ของตัวเอง (ASM สร้างเอง) | เห็นปกติ                                                          |
| sdm / pte / cdr                                     | ใด ๆ                                   | เห็นปกติ (ผ่าน`/approval/sdm/`, ไม่มี ownership check) |
| fin / adt / adm ยิง`/approval/sam/{id}` ตรง | ใด ๆ                                   | ปัจจุบันได้**403** — ดู Known issue #1                |

### TC-13 · Net Freight snapshot

**Steps:**

1. จด `FREIGHT_SUBSIDY_BT` ของ (org, **sold-to แรกของ proposal**, product, **งวดเดียวกับ proposal**) จาก SQL §3 → save rebate → submit → ดูหน้า approval = ค่าที่จด
2. อัปเดต/sync subsidy master เป็นค่าใหม่ → refresh หน้า approval
3. (ถ้ายังแก้ proposal ได้) กลับไป save rebate ใหม่ → ดูอีกครั้ง
4. เคสไม่ match: proposal งวด/ลูกค้า/สินค้า ที่ไม่มีแถวใน master → Net Freight = 0 และ save ได้ปกติ

**Expected:** ข้อ 2 → ค่า**ไม่เปลี่ยน** (snapshot); ข้อ 3 → เปลี่ยนเป็นค่าใหม่; ข้อ 4 → 0 ไม่ error; **ไม่มี fallback** ไป grain กว้าง/งวดล่าสุด (SAM-1762)

### TC-14 · Format การแสดงผล

**Expected:** เลขพันคั่น comma (2,694); ไม่มีทศนิยมทุกช่อง; rate ที่กรอกเป็นทศนิยม (เช่น 5.9) → แสดง 5 (ตัดทิ้ง ไม่ปัด); ช่องว่าง render เป็นค่าว่าง ไม่ใช่ NaN/undefined

---

## 7. Known Issues / Limitations (อย่า log ซ้ำ)

| # | อาการ                                                                                                                                                                                                       | สถานะ                                                                    |
| - | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1 | Finance / Auditor / System Admin ผ่าน policy ของ`/approval/sam/{id}` ได้ แต่โดน ownership check เตะ 403 เสมอ — role พวกนี้ใช้ endpoint นี้ไม่ได้จริง             | รอ decision ว่า requirement ต้องการให้ดูได้หรือไม่ |
| 2 | Type P: previous ที่เลขหน้าไม่ต่อเนื่อง (ลบหน้าแล้วไม่ renumber) → PM = 0 เพราะจับคู่เลขหน้าตรง ๆ (ยังไม่มี reindex fix แบบ Type R/S)       | Known limitation                                                              |
| 3 | Net Freight match ราย sold-to แล้ว (SAM-1762/CR5.1) แต่ proposal หลาย sold-to ใช้ `SOLDTO_CODE` ตัวแรกตัวเดียว — ลูกค้าอื่นในกลุ่มไม่ถูกนำมาคิด | Scope decision — by design |
| 4 | Draft/Temp เปิดผ่าน endpoint ได้ถ้า ownership ผ่าน (ไม่มี status filter)                                                                                                                  | Behavior ปัจจุบัน                                                     |

---

## 8. อ้างอิง Code (สำหรับ dev ตอน triage)

| ส่วน                               | ไฟล์                                                                                                                                      |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| BE Type R (SAM)                        | `Features/Approval/Sam/GetById/OverviewDetailTypeR.cs`                                                                                      |
| BE Type S (SAM)                        | `Features/Approval/Sam/GetById/OverviewDetailTypeS.cs`                                                                                      |
| BE Type P (SAM)                        | `Features/Approval/Sam/GetById/OverViewDetailTypeP.cs`                                                                                      |
| BE ชุด SDM/PTE/CDR                  | `Features/Approval/Sdm/GetById/` (logic ซ้ำอีกชุด — bug อาจเกิดฝั่งเดียว ต้องเทสทั้งสอง role track) |
| จุด stamp SUBSIDY                   | `Features/ProposalDetails/CreateCommand/CreateProposalProductDiscountRebate.cs`                                                             |
| FE column ต่อ role/type             | `features/approval/constants/rebate-columns.ts`                                                                                             |
| FE ตาราง                          | `features/approval/components/details/type-r/overview/ViewRebateInformation.tsx`                                                            |
| รายละเอียดเพิ่มเติม | `.claude/docs/features/approval.md` § Detail Overview                                                                                      |
