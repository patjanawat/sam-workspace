# QA Manual — หน้า ปริมาณการซื้อ / Sales Volume (`/rebates/sales-volume`)

> เวอร์ชัน: 2026-07-03 · อ้างอิง code: SAM repo branch `develop` @ `356bd3fd`
> ครอบคลุม: ปุ่ม Sync Data, ปุ่ม Export Excel, ที่มาของข้อมูล, ข้อจำกัด

---

## 1. หน้านี้ทำอะไร

จัดการข้อมูล **ยอดขายจริง (Sales Volume)** ที่ sync มาจาก SAP data warehouse — ข้อมูลชุดนี้ระบบใช้ประกอบงาน rebate (เทียบยอดขายจริงกับเป้า). หน้าจอมี:

- Dropdown **ปี** + **เดือน** (เลือกได้ค่าเดียว, มีตัวเลือก "เลือกทั้งหมด")
- ปุ่ม **Sync Data** — ดึงข้อมูลจาก SAP เข้าระบบใหม่
- ปุ่ม **Export** — ดาวน์โหลดข้อมูลเดือนที่เลือกเป็น Excel

**ไม่มีตารางแสดงข้อมูลบนจอ** — ดูข้อมูลได้ทางไฟล์ Excel เท่านั้น

---

## 2. พฤติกรรม 2 ปุ่ม (ต้องเข้าใจก่อนเทส)

### 2.1 Sync Data

```
ปุ่ม Sync → POST /report/sync-sale-volume (ไม่มี parameter)
         → EXEC dbo.sp_Sync_S_Vol
         → DELETE ข้อมูลช่วง 1 ม.ค. ปีก่อน → 31 ธ.ค. ปีปัจจุบัน ทั้งหมด
         → INSERT ใหม่จาก linked server ACCDW (View_SAM_Vol) ช่วงเดียวกัน
```

- ⚠️ **ปี/เดือนที่เลือกบนจอ ไม่มีผลต่อ Sync** — sync เต็มช่วง 2 ปี (ปีก่อน + ปีปัจจุบัน) เสมอ
- Sync เป็นแบบรอผล (synchronous) — ข้อมูลมาก/linked server ช้า = ปุ่มหมุนนาน
- ไม่ผ่าน validation ของ form — กดได้แม้ยังไม่เลือกปี/เดือน
- สำเร็จ → toast "ปรับข้อมูลสำเร็จ Sync completed successfully."

### 2.2 Export

```
ปุ่ม Export → validate: ต้องเลือกปีและเดือนจริง (ห้าม "เลือกทั้งหมด")
           → GET /report/sale-volume?Year=YYYY&Month=M
           → query warehouse.S_Vol ช่วงวันแรก–วันสุดท้ายของเดือนนั้น
           → ไฟล์ SalesVolume_{timestamp}.xlsx
```

- **บังคับเลือกทั้งปีและเดือน** — ค่า default คือ "เลือกทั้งหมด" → กด Export ทันทีจะขึ้น "กรุณาระบุ" ทั้งสองช่อง (ดู Known issue #2)
- Export ครั้งละ 1 เดือนเท่านั้น

---

## 3. สิทธิ์เข้าถึง

ทั้งสอง endpoint เป็น `[Authorize]` เปล่า — **ทุก role ที่ login ได้ ใช้ได้ทั้ง Sync และ Export** และเห็นข้อมูล**ทุก Sales Org ทั้งบริษัท** (ไม่มีการ scope ตาม role — ต่างจาก report Proposal Tracking)

---

## 4. โครงสร้างไฟล์ Excel

Sheet "Sales Volume", header ฟ้า, 11 columns — dump ดิบจากตาราง `warehouse.S_Vol`

| Column | ความหมาย | Source |
|---|---|---|
| ORGNO | รหัส Sales Org | `S_Vol.SAL_ORG_CODE` |
| DATE | วันที่ขาย รูปแบบ `yyyyMMdd` (เป็น text) | `S_Vol.DATE` |
| SDCODE | รหัสลูกค้า Sold-to | `S_Vol.SoldtoCode` |
| SHCODE | รหัส Ship-to | `S_Vol.ShiptoCode` |
| PCODE | รหัสสินค้า | `S_Vol.ProductCode` |
| SHIPPOINT | จุดส่งของ | `S_Vol.SHIPPOINT` |
| CONTRACT | เลข contract (Type P) | `S_Vol.CONTRACT` |
| QTY | ปริมาณ (ตัน) ทศนิยม 3 ตำแหน่ง | `S_Vol.QTY` |
| QTY31 / QTY32 / QTY33 | ปริมาณแยกย่อย (คาดว่าแยกตามเงื่อนไขขนส่ง 31/32/33 — ให้ QA ยืนยันกับ BA) | `S_Vol.QTY31–33` |

- Grain: 1 แถว = (org × วัน × sold-to × ship-to × product × shippoint)
- เรียง: org → วันที่ → sold-to → ship-to → product → shippoint
- ต้นทางข้อมูลจริง: view `View_SAM_Vol` บน ACCDW (SAP DW) — สูตร/แหล่งอยู่นอกระบบ SAM

---

## 5. Test Cases

### TC-01 · Export ต้องเลือกปี+เดือน
**Steps:** เปิดหน้า (ค่า default = เลือกทั้งหมด) → กด Export ทันที
**Expected:** error "กรุณาระบุ" ใต้ทั้งช่องปีและเดือน; ไม่มี request ยิงออก (เช็ค network tab)

### TC-02 · Export เดือนที่มีข้อมูล
**Steps:** Sync ก่อน → เลือกปี/เดือนที่มียอดขาย → Export
**Expected:** ได้ไฟล์ `SalesVolume_{YYYYMMDD_HHmm}.xlsx`; ทุกแถว DATE อยู่ในเดือนที่เลือก (วันแรก–วันสุดท้าย); toast success

### TC-03 · Export เดือนไม่มีข้อมูล
**Steps:** เลือกเดือนอนาคต → Export
**Expected:** ได้ไฟล์มี header อย่างเดียว 0 แถว data — ไม่ error

### TC-04 · ขอบเขตเดือนถูกต้อง (boundary)
**Steps:** เตรียมข้อมูลวันที่ 31 ม.ค., 1 ก.พ., 28/29 ก.พ., 1 มี.ค. → export ก.พ.
**Expected:** ได้เฉพาะ 1 ก.พ. + 28/29 ก.พ.; ปีอธิกสุรทินรวม 29 ก.พ. ด้วย

### TC-05 · Sync ครอบ 2 ปี ไม่สนใจ filter
**Steps:** เลือกปี/เดือนใดก็ได้ (หรือไม่เลือก) → กด Sync → export เทียบหลายเดือนทั้งปีก่อนและปีนี้
**Expected:** ข้อมูล**ทุกเดือนของปีก่อน+ปีนี้** ถูก refresh ตามต้นทาง SAP — ไม่ใช่แค่เดือนที่เลือก (behavior ปัจจุบัน — ดู Known issue #1)

### TC-06 · Sync แล้วข้อมูลตรงต้นทาง
**Steps:** เทียบยอด QTY ใน Excel กับ view ต้นทาง (ให้ dev ช่วย query `View_SAM_Vol`) สัก 3–5 แถว
**Expected:** ตรงกันทุกค่า รวมทศนิยม 3 ตำแหน่ง

### TC-07 · Sync ซ้ำไม่ทำข้อมูลเบิ้ล
**Steps:** Sync 2 ครั้งติด → export เดือนเดิม
**Expected:** จำนวนแถวเท่าเดิม (SP delete ก่อน insert — ไม่ duplicate)

### TC-08 · กดปุ่มระหว่างอีกปุ่มทำงาน
**Steps:** กด Sync → ระหว่างหมุน ลองกด Export และแก้ dropdown
**Expected:** ทุก control disabled จนเสร็จ; จบแล้วกลับมาใช้ได้

### TC-09 · Sync ล้มเหลว
**Steps:** จำลอง linked server ล่ม / ตัด network → Sync
**Expected:** toast "Failed to sync Sales Volume data"; ข้อมูลเดิมต้องไม่หาย (SP มี transaction — ล้มเหลว = rollback ทั้งก้อน)

### TC-10 · ทุก role ใช้ได้
**Steps:** login srp / sam / sdm / pte / fin / adm → เปิดหน้า กด Export
**Expected:** ใช้ได้ทุก role, ข้อมูลเหมือนกันทุก role (ไม่มี scope) — ถ้า requirement ต้องการจำกัด แจ้ง BA (ดู Known issue #3)

---

## 6. Known Issues / Limitations (อย่า log ซ้ำ)

| # | อาการ | สถานะ |
|---|---|---|
| 1 | **Sync ไม่สนใจปี/เดือนที่เลือก** — UI ชวนให้เข้าใจว่า sync เฉพาะช่วงที่เลือก แต่จริง sync ปีก่อน+ปีนี้ทั้งหมดเสมอ (FE ส่งค่าแต่ hook/BE/SP ไม่ใช้) | UX misleading — ควรแจ้ง dev/BA |
| 2 | **Dropdown มี "เลือกทั้งหมด" แต่ Export ห้ามใช้** และเป็นค่า default → เปิดหน้ามากด Export = error ทันที | UX — ควรตัด option หรือ default เป็นเดือนปัจจุบัน |
| 3 | ไม่มี role scoping — srp เห็นยอดขายทั้งบริษัทผ่าน export | รอ decision requirement |
| 4 | Sync synchronous + ไม่มี job guard — กดพร้อมกันหลายคน/หลายแท็บได้ อาจ contention ที่ DB (transaction ป้องกันข้อมูลพังแล้ว) | Limitation |
| 5 | ชื่อไฟล์ FE (`SalesVolume_*`) กับ BE (`Sale_Volume_YYYYMM_*`) คนละชื่อ — FE ชนะ | By design |
| 6 | comment ใน hook FE เขียน endpoint ผิด (บอก GET สำหรับ sync จริงคือ POST `/report/sync-sale-volume`) | Code hygiene |

---

## 7. อ้างอิง Code (สำหรับ dev ตอน triage)

| ส่วน | ไฟล์ |
|---|---|
| FE หน้าจอ | `features/rebate/components/SalesVolumeWrapper.tsx` |
| FE hooks | `features/rebate/hooks/useReportSaleVolume.ts` |
| FE schema (บังคับเลือกปี/เดือน) | `features/rebate/schema/rebate.schema.ts` |
| BE export | `Features/Report/SaleVolume/SaleVolumeEndpoint.cs` + `SaleVolumeHandler.cs` |
| BE sync | `Features/Report/SyncSaleVolume/SyncSaleVolumeEndpoint.cs` + `SyncSaleVolumeHandler.cs` |
| SP sync | `Sql/PamDB/Store-view/sp_Sync_warehouse.sql` → `sp_Sync_S_Vol` (ดึงจาก `ACCDW.View_SAM_Vol` linked server) |
| Entity | `Entities/S_Vol.cs` (`warehouse.S_Vol`) |
