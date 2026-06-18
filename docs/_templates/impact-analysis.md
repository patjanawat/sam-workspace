# CR#<N> <ชื่อ CR> — Impact Analysis (FE/BE)

> Template: copy ไป `docs/CR<N>/impact-analysis.md` แล้วเติมทุก section — ลบ comment `<!-- -->` ทิ้ง
> หลักการ:
> - ทุก claim ต้องมี code anchor `file:line` ที่ verify แล้ว (เปิดไฟล์จริง ไม่เดา) — verify **behavior ของ code เดิม** ด้วย ไม่ใช่แค่ anchor มีจริง (เช่น query ใช้ `TOP(1)` / branch / null-handling อะไร)
> - ไฟล์ใหม่ mark "(ใหม่)" · ทุกแถวมี Severity H/M/L
> - **Source path ทุกอันต้อง resolve จริง** (เปิดได้) — ห้าม path ตาย
> - **ทุก Decision ต้อง propagate ครบ**: ระบุ spec section ที่ถูก override (§ Decisions) แล้วไล่แก้ section นั้นจริงในไฟล์ spec — ห้ามทิ้ง section เก่าขัดกับมติ

**Sources:**
- Spec: `docs/CR<N>/<spec>.md`
- Meeting: `docs/CR<N>/<meeting-summary>.md`
- Requirement/Mockup: `docs/CR<N>/<...>`
- Codebase: SAM submodule (`web/web/backend/`, `web/web/frontend/`)

**Change summary:** <1-3 ประโยค: ทำอะไร ให้ใคร scope ไหน>
**Formula/Logic หลัก:** <สูตรคำนวณ / business rule แกนกลาง ถ้ามี>
**Key / Grain (canonical — อ้างชื่อนี้ทุกที่):** <composite key / grain แกนกลาง — ชื่อ field ตรง code (param ↔ DB column) · flag ส่วนที่ยัง open>

## Discovery — current state

<!-- ตารางสำรวจของที่มีอยู่: สิ่งที่ requirement ต้องการ vs สถานะจริงใน codebase (✅มี / ⚠️มีบางส่วน / ❌ไม่มี) + anchor -->

| สิ่งที่ต้องมี | สถานะปัจจุบัน |
|---|---|
| | |

⚠️ <ข้อขัดแย้ง requirement vs codebase ที่เจอตอน discovery — ยกขึ้นมาให้เห็นก่อน>

## Decisions (supersedes spec §)

<!-- มติจาก meeting/PO — แต่ละข้อ MUST ระบุ spec section ที่ถูก override + mark applied เมื่อแก้ section นั้นในไฟล์ spec แล้ว -->
<!-- กฎ: Decision ทุกข้อที่เป็น "ยกเลิก/เปลี่ยน policy" → ต้องไล่ลบ/แก้ section เก่าใน spec (rollback, monitoring, metric, AC, estimate) ให้หมด ไม่ใช่แค่ section หลัก -->

| Decision | Supersedes (spec §) | Status |
|---|---|---|
| <มติ> | <§ ที่ override — list ให้ครบทุกที่ที่อ้าง policy เก่า> | ✅ applied / ⬜ pending |

## Backend Impact

<!-- แบ่ง sub-section ตามกลุ่มงาน เช่น endpoint ใหม่ / แก้ handler เดิม / policy / schema / tests -->

### <กลุ่มงาน>

| File | Change | Severity |
|---|---|---|
| `path/File.cs:line` | | **H** |

### Schema (migration)

| Item | Change |
|---|---|
| | |

### Tests

| File | Change |
|---|---|
| | |

**BE file count:** <X ไฟล์ใหม่ + แก้ Y จุดเดิม + migration + tests>

## Frontend Impact

<!-- แบ่ง sub-section: menu/permission / pages / components / hooks / state / types+schema / i18n / MSW -->

### <กลุ่มงาน>

| File | Change | Severity |
|---|---|---|
| `path/file.tsx:line` | | **H** |

**FE file count:** <X ไฟล์ใหม่ + แก้ Y ไฟล์เดิม + i18n + MSW>

## Constraints (per meeting)

<!-- กฎ cross-ref: ทุกแถว Constraint ที่เป็นพฤติกรรมใหม่ ต้องมี (ก) แถว Effort ใน § Effort Estimate และ (ข) AC ในไฟล์ spec — เติม ref ในคอลัมน์ Effort/AC ให้ครบ มิฉะนั้น = scope ใหม่ที่ไม่ได้นับ -->

| Rule | Enforcement | Effort row | AC |
|---|---|---|---|
| <มติจาก meeting> | <บังคับที่ชั้นไหน FE/BE/SQL> | <ref แถวใน Effort Estimate> | <AC-xx-n ในไฟล์ spec> |

## Risk / Blocker

| Item | Severity | Note |
|---|---|---|
| | **High** | |

## Effort Estimate

<!-- granular 0.3–0.5 d ต่อ task · ต้องมีแถว tests, Code review + QA + UAT, Buffer เสมอ -->

| Phase | Effort |
|---|---|
| | d |
| Code review + QA + UAT support | d |
| Buffer (open questions / rework) | d |
| **Total** | **~X d** |

**Timeline:** <จำนวนคน + calendar>

## Action Items

<!-- numbered สั่งงานได้เลย — ข้อที่ block dev ให้เขียน "(block <อะไร>)" -->

1.
