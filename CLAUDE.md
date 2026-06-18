# CLAUDE.md — SAM Workspace

## Workspace Overview

This is the **SAM Workspace** — a meta-repository that bundles the SAM platform codebase and AI agent configurations together for development with Claude Code.

| Path | Purpose |
|---|---|
| `web/` | SAM platform codebase (symlink → `d:\2025\ManaoSoftware\sam\`) |
| `.claude/agents/` | Agent definitions |
| `.claude/agents/_shared/` | Shared context files — stack, conventions, paths, BA context |
| `tasks/<SAM-XXXX>/` | Per-ticket scratchpads (gitignored) — plan.md + progress.md |

---

## Business Domain

**SAM** (Sales Activity Management) คือระบบจัดการกิจกรรมการขายสำหรับองค์กร ใช้ภายในบริษัทสำหรับ Sales team

### Core Flow

```
Sale Rep สร้าง Proposal → ส่ง Pending → Approval chain → Approved → Sync to SAP
```

### Key Concepts

| Term | ความหมาย |
|---|---|
| **Proposal** | คำขออนุมัติราคา/โปรโมชั่นที่ Sale Rep สร้างขึ้น มีสถานะ Draft → Pending → Approved/Rejected |
| **ProposalGroup** | ประเภทของ Proposal (เช่น Type R, Type S, Type P) — กำหนดว่า Proposal มี product และ pricing แบบไหน |
| **Approval** | ขั้นตอนการอนุมัติ Proposal — ผ่านหลาย role ตาม hierarchy |
| **ApprovalHistory** | log การ approve/reject แต่ละขั้น รวมถึง delegate และ bypass |
| **Rebate** | ส่วนลดย้อนหลังที่คำนวณจาก volume การขาย |
| **CustomerGroup** | กลุ่มลูกค้าที่ผูกกับ Proposal |
| **SAP Sync** | การส่งข้อมูล Proposal ที่ approved ไปยัง SAP ERP |
| **UserDelegate** | การมอบอำนาจอนุมัติชั่วคราวให้ผู้อื่น |
| **CloseMonth** | การปิดรอบเดือน — ล็อค Proposal ของเดือนนั้นไม่ให้แก้ไข |

### Roles & Approval Hierarchy

| Code | Role | หน้าที่ |
|---|---|---|
| `srp` | Sale Representative | สร้าง Proposal |
| `sam` | Area Sale Manager | อนุมัติระดับ Area |
| `sdm` | Sale Division Manager | อนุมัติระดับ Division |
| `cdr` | Commercial Director | อนุมัติสูงสุด |
| `pte` | Pricing Team | ตรวจสอบราคา |
| `fin` | Finance | ตรวจสอบการเงิน |
| `adt` | Auditor | ตรวจสอบ audit |
| `sla` | Sale Admin | จัดการข้อมูล master |
| `adm` | System Admin | จัดการระบบ |

### Proposal Status

```
Draft (1) → Pending (2) → Approved (3)
                       → Rejected (4)
                       → Skipped (5)
```

---

## Project Summary

### Backend — `web/web/backend/`
- **Framework**: .NET 10, C# — FastEndpoints + Carter
- **ORM**: Entity Framework Core 10 + Dapper
- **Database**: SQL Server
- **Auth**: JWT Bearer + ASP.NET Identity
- **Jobs**: Hangfire (SQL Server)
- **Storage**: MinIO
- **Logging**: Serilog
- **Mapping**: Mapster
- **Validation**: FluentValidation

### Frontend — `web/web/frontend/`
- **Framework**: Next.js 15 (App Router), TypeScript
- **UI**: Radix UI + Tailwind CSS v4
- **State**: Zustand + TanStack Query v5
- **Form**: React Hook Form + Zod v4
- **Table**: TanStack Table
- **Mock**: MSW v2

---

## Running the Project

### Backend
```bash
cd web/web/backend
dotnet run --project SamApp.WebApi
```

### Frontend
```bash
cd web/web/frontend
npm run dev:local        # local env
npm run dev:development  # dev env
```

### Tests (Backend)
```bash
# Run all tests
dotnet test web/web/backend/SamApp.WebApi.Tests/

# Run tests for specific feature
dotnet test web/web/backend/SamApp.WebApi.Tests/ --filter "FullyQualifiedName~{Feature}"

# With output
dotnet test web/web/backend/SamApp.WebApi.Tests/ --logger "console;verbosity=normal"
```

### Git (submodule)
```bash
# All git commands inside the SAM repo must use -C web
git -C web status
git -C web checkout -b feature/SAM-123-description
git -C web add .
git -C web commit -m "feat: ..."
git -C web push
```

---

## Agents

| Agent | When to use |
|---|---|
| `ba-expert` | Draft tickets, scaffold tasks/<TICKET>/, validate/split stories — upstream of orchestrator |
| `orchestrator` | Complex multi-step tasks spanning BE + FE |
| `dotnet-developer` | Creating or modifying BE — endpoints, EF, Hangfire |
| `frontend-developer` | Creating or modifying FE — pages, components, API calls |
| `tester` | Verify bug fix or new feature — writes xUnit tests + scenarios |
| `code-reviewer` | Reviewing code before committing |
| `expert-viewer` | Deep read-only investigation — root cause, "why does X work this way" |
| `cr-analyst` | Change Request impact analysis — produce/reconcile/audit `docs/CR<N>/`. Owns CR docs; never touches `web/`, never commits |

See `.claude/agents/AGENT_TRIGGERS.md` for routing rules and trigger keywords.

---

## Workspace Rules

- **Before starting any task — summarize what will be done, which files will be affected, and wait for confirmation before proceeding**
- **Always create a new branch before making any code changes** — never work directly on `develop` or `master`
- **Never make any code change without explicit user confirmation** — present the plan, wait for "yes" or "confirm", then proceed
- **Never commit or push without explicit user confirmation**
- **NEVER modify any files inside `web/`** — do NOT edit any FE or BE source files under `web/` (including `web/web/backend/` and `web/web/frontend/`) unless explicitly instructed
- `web/` is a symlink — always use `git -C web` for git operations inside the SAM repo

### Workflow for Every Task

Each ticket has a scratchpad folder at `tasks/<TICKET>/` (gitignored) containing `plan.md` (plan & evolving summary) and `progress.md` (phased checklist + log). They live in the **workspace**, not in `web/`.

> **Auto-invoke ba-expert FIRST:** Any user prompt that references a ticket folder (`tasks/<SAM-XXXX>/`) or a `SAM-NNNN` identifier — including verbs like *analysis / analyze / find solution / วิเคราะห์ / หา solution / อ่าน / เปิด* — MUST invoke the `ba-expert` agent first to scaffold or refresh `tasks/<TICKET>/plan.md` + `progress.md`. No investigation, `expert-viewer` call, code reading, or implementation may start until ba-expert finishes and the user confirms the plan.

1. **Summarize the plan** — describe what will change, which files, any risks — save to `tasks/<TICKET>/plan.md` and seed `tasks/<TICKET>/progress.md` — wait for confirmation before writing any code
2. **Create branch** — `git -C web checkout -b <type>/SAM-XXX-description`

   Branch naming:
   ```
   feature/SAM-123-short-description
   bugfix/SAM-456-short-description
   hotfix/SAM-789-short-description
   chore/short-description
   refactor/short-description
   ```
3. **Implement** — delegate to specialist agents — update `progress.md` Log with each meaningful state change
4. **Summarize what was done** — list files changed — wait for confirmation
5. **Commit & push** — only after explicit user confirmation — append commit hash + push status to `progress.md` Log

---

## Feature Docs

Detailed docs per feature — read before working on a specific area. Docs describe endpoints, files, hooks, and business rules/gotchas not obvious from code.

| Doc | Feature |
|-----|---------|
| [`.claude/docs/features/proposal.md`](.claude/docs/features/proposal.md) | Proposal / Request — create, general info, rebate types, submit |
| [`.claude/docs/features/approval.md`](.claude/docs/features/approval.md) | Approval workflow — SAM/SDM tracks, bulk approve, delegate settings |
| [`.claude/docs/features/customer-group.md`](.claude/docs/features/customer-group.md) | Customer Group & Relation — group types, overlap detection |
| [`.claude/docs/features/rebate.md`](.claude/docs/features/rebate.md) | Month-end Rebate — Agreement, Accrued Sum, 4-step workflow |
| [`.claude/docs/features/sap-sync.md`](.claude/docs/features/sap-sync.md) | SAP Sync — auto-sync, re-sync page, success indicators |
| [`.claude/docs/features/user-settings.md`](.claude/docs/features/user-settings.md) | User Management — CRUD, roles, delegate, password policy |
| [`.claude/docs/features/auth.md`](.claude/docs/features/auth.md) | Auth — login flow, JWT, cookies, middleware, proxy pattern |
| [`.claude/docs/gotchas.md`](.claude/docs/gotchas.md) | **Cross-cutting gotchas** — read this first for any task |

> **Selective loading**: load only the relevant feature doc for your task — don't load all of them at once.

---

## CR Docs Convention

ทุก Change Request ต้องมีเอกสารหลัก **`docs/CR<N>/impact-analysis.md`** ตาม template [`docs/_templates/impact-analysis.md`](docs/_templates/impact-analysis.md)

> **เจ้าของ artifact = agent `cr-analyst`** — ทุกงาน CR (สร้าง / reconcile spec↔impact / audit drift) route ไปที่ cr-analyst (ไม่ใช่ ba-expert ซึ่งคุม `tasks/<TICKET>/`). cr-analyst ห้ามแตะ `web/` ห้าม commit.

- โครงบังคับ: Sources → Change summary → **Key/Grain** → Discovery → **Decisions (supersedes spec §)** → Backend Impact → Frontend Impact → Constraints → Risk/Blocker → Effort Estimate → Action Items
- ทุก decision ต้อง propagate ครบทุก section ที่ override (ไม่ใช่แค่ section หลัก) + ทุก constraint ใหม่ต้องมี Effort row + AC คู่
- ทุก claim ต้องมี code anchor `file:line` ที่ verify จาก codebase จริง (เปิดไฟล์ ไม่เดา) — verify **behavior ของ code เดิม** ด้วย ไม่ใช่แค่ anchor มีจริง · ไฟล์ใหม่ mark "(ใหม่)"
- Impact table ทุกแถวมี Severity **H/M/L** — FE ต้องครอบถึง types, Zod schema, i18n, MSW ไม่ใช่แค่ component หลัก
- Estimate granular 0.3–0.5 d ต่อ task และต้องมีแถว tests, **Code review + QA + UAT**, Buffer เสมอ
- ไฟล์ประกอบ (meeting summary, mockup, transcript, draft) อยู่ใน `docs/CR<N>/` ได้ แต่ผลวิเคราะห์สุดท้ายต้อง consolidate ลง `impact-analysis.md` เสมอ — อ้างอิงตัวอย่าง: [`docs/CR7-rebate-summary/impact-analysis.md`](docs/CR7-rebate-summary/impact-analysis.md), [`docs/CR6/impact-analysis.md`](docs/CR6/impact-analysis.md)

---

## Key Paths

### Backend (`web/web/backend/SamApp.WebApi/`)

| Path | Purpose |
|---|---|
| `Features/` | Feature modules (Vertical Slice) |
| `Features/Proposal/` | Proposal management |
| `Features/Approval/` | Approval workflow |
| `Features/Customers/` | Customer management |
| `Features/Rebates/` | Rebate management |
| `Features/SapSync/` | SAP integration |
| `Features/User/` | User management |
| `Features/Role/` | Role & permissions |
| `Entities/` | EF Core entity models |
| `Migrations/` | EF Core database migrations |
| `Infrastructure/` | DI setup, middleware, shared services |
| `appsettings.json` | Base configuration |

### Frontend (`web/web/frontend/src/`)

| Path | Purpose |
|---|---|
| `app/` | Next.js App Router pages |
| `features/` | Feature modules |
| `features/request/` | Proposal/request pages |
| `features/approval/` | Approval pages |
| `features/customers/` | Customer pages |
| `features/rebate/` | Rebate pages |
| `features/sap-sync/` | SAP sync pages |
| `components/` | Shared UI components |
| `server/` | Server actions & API client |
| `types/` | TypeScript types & Zod schemas |
| `hooks/` | Custom React hooks |
| `lib/` | Utilities |
