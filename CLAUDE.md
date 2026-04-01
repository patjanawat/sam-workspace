# CLAUDE.md — SAM Workspace

## Workspace Overview

This is the **SAM Workspace** — a meta-repository that bundles the SAM platform codebase and AI agent configurations together for development with Claude Code.

| Path | Purpose |
|---|---|
| `web/` | SAM platform codebase (submodule — Bitbucket: `manaosoftware/sam`) |
| `.claude/agents/` | Agent definitions |

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
| `orchestrator` | Complex multi-step tasks spanning BE + FE |
| `dotnet-developer` | Creating or modifying BE — endpoints, EF, Hangfire |
| `frontend-developer` | Creating or modifying FE — pages, components, API calls |
| `tester` | Verify bug fix or new feature — writes xUnit tests + scenarios |
| `code-reviewer` | Reviewing code before committing |

---

## Workspace Rules

- **Before starting any task — summarize what will be done, which files will be affected, and wait for confirmation before proceeding**
- **Always create a new branch before making any code changes** — never work directly on `develop` or `master`
- **Never commit or push without explicit user confirmation**
- All code changes target `web/web/` — backend in `backend/`, frontend in `frontend/`
- `web/` is a git submodule — always use `git -C web` for git operations inside it

### Workflow for Every Task

1. **Summarize the plan** — describe what will change, which files, any risks — wait for confirmation
2. **Create branch** — `git -C web checkout -b <type>/SAM-XXX-description`

   Branch naming:
   ```
   feature/SAM-123-short-description
   bugfix/SAM-456-short-description
   hotfix/SAM-789-short-description
   chore/short-description
   ```
3. **Implement** — delegate to specialist agents
4. **Summarize what was done** — list files changed — wait for confirmation
5. **Commit & push** — only after explicit user confirmation

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
