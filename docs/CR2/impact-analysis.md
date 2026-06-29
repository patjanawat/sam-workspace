# CR#2 Clone Proposal Type P (cross-month within year) — Impact Analysis (FE/BE)

**Sources:**
- Spec: `docs/CR2/project-proposal-management.md` (generic version — From/To picker approach, broader scope)
- Meeting: `docs/review-meeting-summary.md` ข้อ 2 — "Clone Proposal Type P (cross-month within year)" (narrowed scope)
- Codebase: SAM submodule (`web/web/backend/`, `web/web/frontend/`)

**Change summary:** ขยาย source dropdown ของ Clone flow จาก `prev month + current month` → `ทุกเดือนภายในปีปัจจุบัน (ห้ามข้ามปี)` เฉพาะ **Type P** เท่านั้น. Type R/S คงพฤติกรรมเดิม (prev+current). เป็นการแก้ filter ฝั่ง backend เป็นหลัก — FE โปร่งใส (แค่ render list ที่ยาวขึ้น + เพิ่ม MSW + search guard).

**Formula/Logic หลัก:**
- Type P (`ProposalGroupId == 1`): `(Year*100 + Month)` อยู่ใน `[thisYear*100 + 1 .. thisYear*100 + 12]`
- Type R/S (`ProposalGroupId != 1`): คงเดิม `[prevMonthYearInt .. currentMonthYearInt]`
- ปีที่ใช้ = ปีตามเวลาไทย (UTC+7) — ปัจจุบัน handler ใช้ `DateTime.Today` (server-local) ไม่ใช่ `TodayHelper.Today` → ต้องแก้ให้ใช้ TH timezone (ดู Constraint C4)

**Key / Grain (canonical — อ้างชื่อนี้ทุกที่):**
- **Type discriminator** = `Proposal.ProposalGroupId` (int). **Type P ⇔ `ProposalGroupId == 1`** ตาม `ProposalGroupEnum { P=1, R=2, S=3 }` (`Shared/Constants/ProposalGroupCode.cs:10-15`). ใช้ค่า int โดยตรง — **ไม่ต้อง** query ตาราง `ProposalGroup` เพื่ออ่าน `CODE` (handler เดิมที่ line 35 ใช้ `ProposalGroupId != 1` เป็น proxy ของ "ไม่ใช่ Type P" อยู่แล้ว).
- **Group grain (source dropdown row)** = `(RequestNo, SaleOrgCode, ProposalGroupId, CustomerGroupId)` → ภายในมีหลาย `Version` (`Month`, `Year`) — ตาม `GroupBy` ใน handler line 36-43.
- **Month-year key** = `Proposal.Year * 100 + Proposal.Month` (int) — `Year`, `Month` เป็น `int` ใน `Entities/Proposal.cs:21-22`.
- **Year base** = **ค.ศ. (AD)** — `Year` ถูก set จาก `request.Year` ตรงๆ (`CreateProposalHandler.cs:127`) และ clone-target guard เทียบกับ `DateTime.Today.Year` ซึ่งเป็น AD (`CreateProposalHandler.cs:27`). ⚠️ ยังไม่ verify ฝั่ง FE ว่าส่ง AD เสมอ — ดู Open Question Q-A1.

## Discovery — current state

| สิ่งที่ requirement ต้องการ | สถานะปัจจุบัน (verified) |
|---|---|
| Source dropdown โชว์ proposal ย้อนหลังภายในปีเดียวกัน (Type P) | ❌ hard-code `prev month ≤ (Year*100+Month) ≤ current month` ทุก type — `GetRequestNumberProposalOptionQueryHandler.cs:21-30` |
| แยกพฤติกรรมตาม Type (P = ทั้งปี, R/S = เดิม) | ❌ ไม่มี branch ตาม type ใน handler — filter เดียวกันหมด `...Handler.cs:24-30` |
| ระบุ Type P โดยไม่ query ตาราง ProposalGroup | ✅ มี `ProposalGroupEnum.P=1` (`ProposalGroupCode.cs:10-15`); handler มี `request.ProposalGroupId` อยู่แล้ว (`GetRequestNumberOptionsQuery.cs:9`) |
| ปีตามเวลาไทย (ห้ามข้ามปี ค.ศ./พ.ศ.) | ⚠️ handler ใช้ `DateTime.Today` (server-local) ไม่ใช่ `TodayHelper.Today` (UTC+7) — `...Handler.cs:21-22` vs `Shared/Helpers/TodayHelper.cs:12-13` |
| รวม proposal `Terminated` ใน source | ⚠️ **ไม่มี status `Terminated`** — `ProposalStatus { Temp=0, Draft=1, Pending=2, Approved=3, Rejected=4, Skip=5 }` (`Shared/Enums/ProposalEnums.cs:22`); grep `[Tt]erminate` ทั่ว backend = 0 hit → ดู Decision D2 + Q-B1 |
| source ต้องเป็น proposal ที่ approved | ✅ บังคับ 2 ชั้น: dropdown filter `WhereApprovedByCommercialDirector()` (`ProposalQueries.cs:56-60`) + clone target guard `CreateProposalHandler.cs:66-68` ("Only APPROVED proposal can be cloned") |
| Type P clone แก้แค่ `value_to` + volume | ✅ `ProposalProductTypeP.TO_DATE` + `VOLUME_TON` (`Entities/ProposalProductTypeP.cs:16,20`) — flow เดิมรองรับ |
| FE hook ส่ง range param | ❌ `useGetRequestNoOptions` ส่งแค่ `saleOrg, proposalGroupId, customerGroupId` — `hooks/index.ts:141-159` (ไม่มี from/to) |
| MSW handler สำหรับ `request-number-options` | ❌ **ไม่มี** — `mocks/features/requests/requests.handlers.ts` มีแค่ `/requests`, `/requests/option(s)`, `/requests/:id`; route นี้จะถูก `:id` จับเป็น 404 |
| i18n labels (en/th) ตาม spec §7.3 | ❌ **ไม่มีระบบ i18n** ใน FE เลย (grep `useTranslation`/`i18next`/locale json = 0) — strings hardcode TH → spec line item เป็นโมฆะ |
| endpoint policy = CreateProposal (srp+sam) | ⚠️ ปัจจุบัน `[Authorize]` เฉยๆ (`GetRequestNumberProposalOptionEndpoint.cs:8,14`); policy `CreateProposal` = srp+sam มีจริง (`Program.cs:162-163`) — optional hardening |

⚠️ **ข้อขัดแย้งหลัก (spec vs meeting vs code):**
1. **Spec บอกให้เพิ่ม From/To month-year pickers + range params + i18n labels** (spec §3, §7.3, §9 steps 6-8, §14.2, AC-FE-1..5) — **มติ meeting ยกเลิก**: ไม่มี picker, backend auto = ปีปัจจุบัน. → spec FE section ทั้งหมดถูก supersede (ดู Decision D1).
2. **Spec FE มี line item "i18n labels (en + th)"** — แต่ codebase **ไม่มีระบบ i18n** เลย → false premise, ตัดทิ้ง (ครอบใน D1).
3. **Meeting พูดถึง "รวม status Terminated"** — แต่ **ไม่มี Terminated status ในระบบ** → ตีความเป็น "Terminate = Modify period (clone + shorten `TO_DATE`) = Modify flow, ไม่มี status ใหม่" (Decision D2) — ยังต้อง BA ยืนยัน (Q-B1).
4. **Spec BE approach** (param-driven From/To, 4 nullable params, validator cohesion) ≠ meeting approach (single type-aware branch, no new param) → ดู Decision D3.

## Decisions (supersedes spec §)

| Decision | Supersedes (spec §) | Status |
|---|---|---|
| **D1 — No date pickers.** Scope แคบเหลือ **Type P เท่านั้น**, range = ปีปัจจุบันแบบ auto (ห้ามข้ามปี). ไม่มี From/To picker, ไม่มี range param, ไม่มี i18n label. FE แค่ render list ยาวขึ้น. (meeting ข้อ 2) | §3 Target State (flow + From/To pickers); §7.3 FE (hook+to/from, clone form pickers, **i18n labels**); §9 Proposed Solution Approach + Steps 6-8; §14.2 FE estimate (hook 0.5d, pickers 1.5d, i18n 0.25d); §16 AC-FE-1, AC-FE-2, AC-FE-5; §4 A2 | ✅ applied (in this doc) · ⬜ pending in spec file |
| **D2 — Terminate = Modify flow, no new status.** Terminate = clone + ลด `TO_DATE` ให้สั้นลง = Modify flow ที่มีอยู่. ไม่เพิ่ม `ProposalStatus` ใหม่. source ที่ clone ได้ยังคงเป็น `Approved` เท่านั้น. (meeting ข้อ 2) | §1 Scope decision (Terminate "deferred, requires BA"); §5 Out of Scope (Terminate); §17 Q1 (mark Resolved-pending-BA); §20 Glossary "Terminate" | ✅ applied (in this doc) · ⬜ pending in spec file · ⚠️ ต้อง BA ยืนยัน Q-B1 |
| **D3 — Type-aware branch, no query param.** BE filter ใช้ `if (ProposalGroupId == 1)` (Type P) → year range, else → prev+current เดิม. **ไม่เพิ่ม** `From*/To*` param ใน query/validator. ใช้ `ProposalGroupId` ที่มีใน query อยู่แล้ว. (meeting ข้อ 2 → narrowest diff) | §3 Target State (add 4 params); §7.2 BE (Query add params, Validator cohesion, "param-or-default" handler); §9 Steps 1-2; §14.1 (query+validator 0.5d); §16 AC-BE-1, AC-BE-3, AC-BE-4 (range/cohesion 400) | ✅ applied (in this doc) · ⬜ pending in spec file |
| **D4 — TH timezone for year boundary.** ปีที่ใช้คำนวณ range ต้องเป็นเวลาไทย (UTC+7) ผ่าน `TodayHelper.Today` ไม่ใช่ `DateTime.Today`. (meeting "ห้ามข้ามปี ค.ศ./พ.ศ.") | (เพิ่มเติม — spec ไม่ได้ระบุ timezone; เป็น constraint ใหม่จาก meeting) | ✅ applied (in this doc) · ⬜ pending in spec file |

> ⬜ **pending in spec file** = ยังไม่ได้แก้ `docs/CR2/project-proposal-management.md` ให้ตรงมติ (Core Rule 2). ดู Action Item 7 — รอ user สั่งจึง propagate ลง spec.

## Backend Impact

### Clone source filter (handler)

| File | Change | Severity |
|---|---|---|
| `Features/Proposal/GetRequestNumberOptions/GetRequestNumberProposalOptionQueryHandler.cs:21-30` | เพิ่ม branch ตาม type: `bool isTypeP = request.ProposalGroupId == (int)ProposalGroupEnum.P;` → ถ้า P ใช้ `minMonthYearInt = thYear*100+1`, `maxMonthYearInt = thYear*100+12`; else คงเดิม (prev→current). ใช้ `thYear = TodayHelper.Today.Year` (D4) แทน `DateTime.Today.Year`. Where-clause line 29-30 อ้าง min/max แทน hard-code. | **H** |
| `Features/Proposal/GetRequestNumberOptions/GetRequestNumberProposalOptionQueryHandler.cs:35` | **ไม่แก้** — `p.ProposalGroupId != 1 \|\| p.SAPStatus == "success"` (Type P ต้อง SAP success) เป็น filter ที่ต้องคงไว้ (verified: `!=1` = ไม่ใช่ Type P) | — |
| `Features/Proposal/GetRequestNumberOptions/GetRequestNumberOptionsQuery.cs:3-12` | **ไม่แก้** — `ProposalGroupId` มีใน query แล้ว (line 9); **ไม่เพิ่ม** From/To param (D3 supersedes spec §7.2) | — |
| `Features/Proposal/GetRequestNumberOptions/GetRequestNumberOptionsQueryValidator.cs:6-19` | **ไม่แก้** — ไม่มี param ใหม่ให้ validate (D3 supersedes spec §7.2 cohesion rule) | — |
| `Features/Proposal/GetRequestNumberOptions/GetRequestNumberProposalOptionEndpoint.cs:8,14` | (optional, L) เปลี่ยน `[Authorize]`/`.RequireAuthorization()` → `.RequireAuthorization("CreateProposal")` (srp+sam, `Program.cs:162-163`). Defer ได้ (ดู Action Item 6) | L |

### Filters / behavior ที่ต้องคงไว้ (verified — ไม่แก้)

| Filter / rule | File | สถานะ |
|---|---|---|
| `WhereApprovedByCommercialDirector()` (Status==Approved && LastApproval.RoleCode==CD) | `ProposalQueries.cs:56-60` | คงเดิม — Terminate ไม่มี status ใหม่ (D2) → ยังเป็น Approved → ผ่าน filter |
| `WhereCustomerGroupNotExpire()` (CustomerGroup.ValidEndDate ≥ today TH) | `ProposalQueries.cs:43-54` | คงเดิม — proposal เก่าที่ customer group หมดอายุจะถูกตัดออกเงียบๆ (by design, R4 spec) |
| SAP success rule (Type P ต้อง SAPStatus=="success") | `...Handler.cs:35` | คงเดิม |
| clone-target month guard (current ≤ target ≤ current+1) | `CreateProposalHandler.cs:27-34` | คงเดิม — เป็น guard คนละตัว, CR นี้ไม่แตะ |
| clone source ต้อง Approved (+ Type P ต้อง SAP success) | `CreateProposalHandler.cs:66-68` | คงเดิม — ยืนยัน D2: source ที่ไม่ Approved clone ไม่ได้แม้จะโผล่ใน dropdown |
| `ProposalStatus` enum | `ProposalEnums.cs:22` | **ไม่เพิ่ม value** (D2) |
| `WhereInPrevCurrNextMonthTh()` helper | `ProposalQueries.cs:8-28` | ยัง unused — ไม่เกี่ยว (ไม่ตรง requirement ปี) — skip |

### Type P entity (no change — verify only)

| File | สถานะ |
|---|---|
| `Entities/ProposalProductTypeP.cs:15-16,20` | `FROM_DATE`/`TO_DATE` (DateOnly) + `VOLUME_TON` — Modify flow แก้ `TO_DATE`/volume ได้อยู่แล้ว (D2) |

### Schema (migration)

| Item | Change |
|---|---|
| — | **None** — pure query-logic change, ไม่มี column/table ใหม่ (ตรง spec §4 A5) |

### Tests

| File | Change |
|---|---|
| `SamApp.WebApi.Tests/Features/Proposal/GetRequestNumberOptions/...` (ใหม่) | xUnit: (1) Type P คืน proposal ทั้งปีปัจจุบัน, (2) Type P **ไม่ข้ามปี** (Dec ปีก่อน + Jan ปีนี้ → คืนเฉพาะปีนี้), (3) Type R **regression** = prev+current เท่านั้น, (4) Type S regression = prev+current, (5) Type P source ที่ไม่ Approved/ไม่ SAP-success ถูกตัดออก, (6) boundary 31 Dec → 1 Jan ใช้ TH timezone (D4) |

**BE file count:** แก้ 1 handler (1 จุด, ~10 บรรทัด) + (optional) 1 endpoint policy + tests ชุดใหม่ 1 ไฟล์. ไม่มี migration. ไม่มี DTO/validator ใหม่.

## Frontend Impact

### Hook + Form (clone tab)

| File | Change | Severity |
|---|---|---|
| `features/request/hooks/index.ts:126-160` `useGetRequestNoOptions` | **ไม่แก้** — backend จัดการ type-aware filter เอง, FE โปร่งใส (D1 supersedes spec §7.3 hook change) | L |
| `features/request/components/list/details/ProposalForm.tsx:91-95,117-120` | clone tab เรียก hook ด้วย 3 keys อยู่แล้ว — **ไม่แก้ logic**. เพิ่ม **client-side search/typeahead** ใน RequestNo dropdown (UX guard: Type P อาจโต ~12× จาก 2 เดือน → ทั้งปี) ถ้ายังไม่มี | M |

### Types / Schema (verify — no change)

| File | Change | Severity |
|---|---|---|
| `features/request/types/request.types.ts:103-105` `RequestNoResponse` / `RequestNoVersion` | **ไม่แก้** — response shape เดิม (backend คืน list ยาวขึ้นแต่ structure เดิม) | L |
| `features/request/types/request.types.ts:167` `ProposalType = 'R'\|'S'\|'P'` | **ไม่แก้** | L |
| `features/request/schema/request.schema.ts` (`RequestFormValues`) | **ไม่แก้** — ไม่มี field ใหม่ (D1 ตัด picker → ไม่มี from/to field ใน schema) | L |
| `shared/enums/proposal.enum.ts:11-16` `ProposalStatus` | **ไม่แก้** — ไม่มี Terminated (D2); FE enum มีแค่ Draft/Pending/Approved/Rejected | L |

### i18n

| Item | Change | Severity |
|---|---|---|
| (ระบบ i18n) | **N/A** — FE ไม่มีระบบ i18n (no `useTranslation`/i18next/locale json). spec §7.3/§14.2 i18n line item เป็น false premise → ตัดทิ้ง (D1). ถ้าเพิ่ม search placeholder string → hardcode TH ตาม convention | L |

### MSW

| File | Change | Severity |
|---|---|---|
| `mocks/features/requests/requests.handlers.ts` | **เพิ่ม handler** `GET .../requests/request-number-options` (ปัจจุบันไม่มี — `:id` จับเป็น 404). ต้องมาก่อน `/:id` หรือ match path ตรง เพื่อไม่ให้ชนกัน | M |
| `mocks/features/requests/__mocks__/request-options.mocks.ts` (ขยาย) | เพิ่ม mock `RequestNoResponse` ที่มี version หลายเดือนในปี (สำหรับเทส UX dropdown ยาว + search) — มี `mockRequestOptions`/`mockVersionOptions` อยู่แล้วให้ reuse/ขยาย | M |

**FE file count:** แก้ 1 component (เพิ่ม search guard, ไม่แก้ logic) + เพิ่ม/แก้ MSW 2 ไฟล์. ไม่มี hook/types/schema/i18n change.

## Constraints (per meeting)

| Rule | Enforcement | Effort row | AC |
|---|---|---|---|
| **C1 — Type P เท่านั้นได้ทั้งปี; R/S คงเดิม** | BE handler branch `if (ProposalGroupId == 1)` (`...Handler.cs:21-30`) | "BE: type-aware filter branch" + "Tests: Type R/S regression" | AC-BE-1, AC-BE-3 (เสนอ — ดู Action Item 7) |
| **C2 — ห้ามข้ามปี (within current year)** | BE: `[thYear*100+1 .. thYear*100+12]` | "BE: type-aware filter branch" | AC-BE-2 |
| **C3 — Terminate = Modify (no new status); source clone ได้เฉพาะ Approved** | BE: ไม่แก้ `ProposalStatus`; คง `WhereApprovedByCommercialDirector` + clone guard | "Tests: source non-Approved ถูกตัด" | AC-BE-4 |
| **C4 — ปีตามเวลาไทย (UTC+7)** | BE: ใช้ `TodayHelper.Today.Year` แทน `DateTime.Today.Year` | "BE: type-aware filter branch" + "Tests: 31 Dec→1 Jan boundary" | AC-BE-5 |
| **C5 — dropdown ยาวขึ้น (Type P ~12×) ต้องมี search** | FE: search/typeahead ใน RequestNo dropdown | "FE: dropdown search guard" | AC-FE-1 |
| **C6 — MSW ครอบ endpoint clone-source** | FE/test: handler ใหม่ใน MSW | "FE: MSW handler + mock" | AC-FE-2 |

> AC ใหม่ที่เสนอ (เพื่อแทน AC-FE-1..5 เดิมที่ถูก D1 supersede) — ต้อง propagate ลง spec §16 (Action Item 7):
> - **AC-BE-1:** Clone source ของ Type P (`ProposalGroupId=1`) คืน proposal ทุกเดือนในปีปัจจุบัน
> - **AC-BE-2:** Type P ปลายปี (เช่น today=2026-01) **ไม่** คืน proposal ของ 2025-12
> - **AC-BE-3:** Type R/S คืนเฉพาะ prev+current month (regression)
> - **AC-BE-4:** Source ที่ไม่ Approved / Type P ที่ SAP ไม่ success **ไม่** อยู่ใน list
> - **AC-BE-5:** Year boundary คำนวณด้วยเวลาไทย (UTC+7)
> - **AC-FE-1:** clone tab Type P render dropdown ที่มี proposal หลายเดือน + ใช้ search ได้
> - **AC-FE-2:** MSW จำลอง `request-number-options` คืน list หลายเดือน (test/dev)

## Risk / Blocker

| Item | Severity | Note |
|---|---|---|
| **Type R/S regression** — handler shared, เผลอ widen R/S เป็นทั้งปี | **High** | Mitigate: explicit `if (ProposalGroupId == 1)` branch + unit test R/S (Test #3, #4). Severity ก่อน mitigation = High |
| **"Terminated" requirement กำกวม** — code ไม่มี Terminated status | **High** | D2 ตีความเป็น Modify flow. ถ้า BA หมายถึง "เพิ่ม Terminate เป็น action/status จริง" → scope บานปลายมาก (ApprovalHistory, SAP, lifecycle). **Block until Q-B1 confirmed** |
| Year boundary edge (ปลายปี) | Med | 1 Jan: Type P เห็นแค่ proposal ปีใหม่ (ปีก่อนถูกตัด) → dropdown อาจว่างต้นปี. UX: ให้ create from blank. ยืนยัน acceptable (Q-A2) |
| AD vs BE year storage | Med | `r.Year` คาดว่าเป็น AD (verified ฝั่ง create guard) แต่ยังไม่ verify FE ส่ง AD ทุกเส้น (Q-A1). ถ้ามีเส้นส่ง BE → range เพี้ยน |
| Timezone mismatch (server-local vs TH) | Med | handler ปัจจุบันใช้ `DateTime.Today` — ถ้า server เป็น UTC, "ปีปัจจุบัน" อาจคลาดช่วงเที่ยงคืน TH. D4 บังคับใช้ `TodayHelper` |
| Dropdown growth (~12×) | Low | C5 search guard. ไม่มี server pagination (ตรง spec §5 out-of-scope) |
| Endpoint policy change (ถ้าทำ) บล็อก caller เดิม | Low | มี FE consumer เดียว (`useGetRequestNoOptions`) → ปลอดภัย. Defer ได้ (Action Item 6) |
| Clone proposal เก่า → pricing/discount stale? | Med | Spec §17 Q4 ยังเปิด. Type P เก่า 6+ เดือนอาจมี master ล้าสมัย. CreateProposal pipeline validate ตอน create แต่ revalidate vs current price list ยังไม่ชัด → BA (Q-A3) |

## Effort Estimate

> granular 0.3–0.5 d/task. unit = man-day.

| Phase / Task | Effort |
|---|---|
| BE: type-aware filter branch (handler, ใช้ `ProposalGroupId==1` + `TodayHelper`) | 0.4 d |
| BE: (optional) endpoint policy `CreateProposal` — defer ได้ | 0.2 d |
| FE: dropdown search/typeahead guard (ProposalForm) | 0.4 d |
| FE: MSW handler + mock `request-number-options` | 0.3 d |
| Tests: xUnit (Type P ทั้งปี / R-S regression / boundary TH / source-not-approved) — 6 cases | 1.0 d |
| Code review + QA + UAT support | 1.0 d |
| Buffer (Q-B1 Terminate, Q-A1 AD/BE, Q-A2 boundary, Q-A3 pricing revalidation) | 0.5 d |
| **Total** | **~3.8 d** (รวม optional policy; ~3.6 d ถ้า defer policy) |

> เทียบ spec §14 (7.5 d): มติ meeting ตัด FE pickers + i18n + range param/validator ออก → ลดเหลือ ~3.8 d. ตัวเลขนี้ **เพิ่ม** scope ที่ spec/draft เดิมตกหล่น: MSW handler (+0.3 d, ไม่มีใน codebase) และ TH-timezone fix (รวมใน BE branch). draft เดิม (~3.5 d) ไม่ได้นับ MSW.
>
> สอดคล้อง `docs/review-meeting-summary.md` ตาราง CR2 = ~3.5 d (BE 0.5 + FE 0.5 + Tests 1.0 + Review/QA/UAT 1.5). ส่วนต่าง +0.3 d = MSW handler ที่ summary ไม่ได้แยก row.

**Timeline:** 1 BE + 1 FE parallel — ~2 calendar days dev + 1 day review/QA/UAT. รวม ~3 วันทำการ (ขึ้นกับ Q-B1).

## Action Items

1. **(block dev)** ยืนยัน Q-B1 กับ BA: "รวม Terminated" = Modify flow (clone + ลด `TO_DATE`, ไม่มี status ใหม่) ตาม D2 ใช่หรือไม่ — ถ้า BA ต้องการ Terminate เป็น action/status จริง scope บานปลาย (block ทั้ง CR)
2. ยืนยัน Q-A1: `Proposal.Year` เก็บเป็น ค.ศ. (AD) เสมอทุกเส้น FE — ตรวจ FE create path ว่าไม่มีจุดส่ง พ.ศ.
3. ยืนยัน Q-A2: ต้นปี (Type P clone source ว่างเพราะปีก่อนถูกตัด) — ยอมรับให้ user create from blank ได้
4. ยืนยัน Q-A3 (spec §17 Q4): clone Type P เก่า → revalidate pricing/discount กับ master ปัจจุบัน หรือ copy-as-is
5. Dev: handler branch ใช้ `request.ProposalGroupId == (int)ProposalGroupEnum.P` + `TodayHelper.Today.Year` (อย่า query ตาราง ProposalGroup, อย่าใช้ `DateTime.Today`)
6. ตัดสินใจ: ทำ endpoint policy `CreateProposal` hardening ใน CR นี้ หรือ defer (กระทบ caller เดียว — ปลอดภัยทั้งสองทาง)
7. **Propagate มติลง spec file** `docs/CR2/project-proposal-management.md` — แก้ §3, §5, §7.2, §7.3, §9, §14, §16, §17 Q1, §20 ตามตาราง Decisions (ปัจจุบัน spec ยังเขียนแบบ From/To picker + i18n + range param ซึ่งขัดมติ) — รอ user สั่ง
8. Dev: เพิ่ม MSW handler `request-number-options` (วางก่อน `/:id` ใน `requests.handlers.ts`) + mock list หลายเดือน
9. Test: ระวัง regression Type R/S — เพิ่ม unit test guard ก่อน merge
