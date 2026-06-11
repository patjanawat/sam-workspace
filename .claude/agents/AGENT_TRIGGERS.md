# Agent Trigger Flow — Cheatsheet

How Main Claude routes user prompts to specialized sub-agents.

---

## Mental Model

```
User
  │
  ▼
Main Claude (default chat session)
  │  scans prompt for keywords
  │  matches agent description
  ▼
Spawn sub-agent (Agent tool)
  │
  ▼
Sub-agent reads shared context → does work → returns result
```

- **Main Claude** = the default agent you chat with. Routes work.
- **Sub-agents** = `.claude/agents/<name>.md` definitions. Each has a `description` field listing trigger keywords.
- **orchestrator** = sub-agent for multi-layer features that need fan-out (BE + FE + DB).

---

## Agent Roster

| Agent | When | Output |
|---|---|---|
| `ba-expert` | Upstream planning: draft ticket, AC, scaffold `tasks/<TICKET>/`, validate, split subtasks | Markdown / scaffolded files. **Never code.** |
| `orchestrator` | Multi-layer feature/ticket spanning BE + FE | Plan + fan out to specialist agents |
| `dotnet-developer` | Create/modify BE — endpoints, EF entities, migrations, Hangfire jobs | .cs files |
| `frontend-developer` | Create/modify FE — pages, components, API hooks, forms | .tsx / .ts files |
| `tester` | Write xUnit tests (BE) or test scenario checklists (FE) | Test files / checklists |
| `code-reviewer` | Pre-merge review — correctness, security, patterns | Findings list |
| `expert-viewer` | Deep read-only investigation, root cause, "why does X work this way" | Analysis text |

---

## Trigger Keywords (Quick Lookup)

### ba-expert
EN: `draft ticket`, `write story`, `user story`, `ticket template`, `acceptance criteria`, `AC list`, `BA review`, `review requirements`, `missing edge case`, `scope this`, `split subtasks`, `subtask breakdown`, `scaffold task`, `extract plan from description`
TH: `เขียน ticket`, `เขียน story`, `ทำ template`, `ทำ AC`, `ตรวจ requirement`, `BA review`, `หา edge case`, `วิเคราะห์ requirement`, `แบ่ง subtask`, `scaffold ticket`, `เริ่ม ticket SAM-`

**Auto-invoke:** any prompt referencing `tasks/SAM-`, `tasks\SAM-`, or `SAM-NNNN` identifier → invoke ba-expert FIRST.

### orchestrator
EN: `implement feature`, `build feature`, `implement SAM-`
TH: `ทำ feature`, `ทำ ticket SAM-`, `วางแผน feature`, `ทำ task ใหญ่`

### dotnet-developer
EN: `create endpoint`, `add API`, `fix BE`, `add entity`, `add migration`, `Hangfire job`
TH: `เพิ่ม endpoint`, `แก้ BE`, `เพิ่ม entity`, `สร้าง migration`, `เพิ่ม handler`

### frontend-developer
EN: `create component`, `build modal`, `add page`, `fix UI`, `build form`, `build table`, `add hook`
TH: `สร้าง component`, `ทำหน้าจอ`, `แก้ UI`, `สร้าง modal`, `ทำฟอร์ม`, `เพิ่ม hook`

### tester
EN: `write tests`, `add unit test`, `test coverage`, `test this handler`, `test this component`
TH: `เขียน test`, `เพิ่ม unit test`, `ทำ test ให้`

### code-reviewer
EN: `review this`, `review my changes`, `check before merge`, `review PR`, `audit code`
TH: `รีวิวโค้ด`, `เช็คก่อน merge`, `ตรวจโค้ด`

### expert-viewer
EN: `why does X happen`, `how does Y work`, `trace this flow`, `explain the logic`, `find root cause`, `investigate`
TH: `วิเคราะห์`, `หาสาเหตุ`, `อธิบายโค้ด`, `trace ตามโค้ด`, `ทำไมถึง`

---

## End-to-End Pipeline (Ideal Ticket)

```
┌──────────────┐      ┌──────────────┐      ┌─────────────────────────┐
│  ba-expert   │ ───► │ orchestrator │ ───► │ specialist agents       │
│              │      │              │      │  ├─ dotnet-developer     │
│ - story      │      │ - plan       │      │  ├─ frontend-developer   │
│ - AC         │      │ - branch     │      │  └─ tester               │
│ - scaffold   │      │ - delegate   │      └─────────────────────────┘
│   tasks/     │      │ - track      │              │
│   <TICKET>/  │      │              │              ▼
└──────────────┘      └──────────────┘      ┌──────────────┐
                                            │ code-reviewer│
                                            └──────────────┘
```

---

## Routing Rules (Main Claude Decision)

```
Single domain, small change
  └─► call specialist agent direct
      (dotnet-developer / frontend-developer / tester)

Cross-layer feature (BE + FE)
  └─► call orchestrator
      └─► orchestrator fans out

Planning / requirements only (no code)
  └─► call ba-expert

Investigation / "why does X" (no code change)
  └─► call expert-viewer

Pre-merge review
  └─► call code-reviewer
```

---

## Examples

| User says | Agent fired |
|---|---|
| "เขียน story feature ยกเลิก Proposal" | `ba-expert` (Draft) |
| "เริ่ม ticket SAM-123" + paste desc | `ba-expert` (Reverse → scaffold) |
| "BA review ticket นี้" | `ba-expert` (Validate) |
| "แบ่ง subtask SAM-456" | `ba-expert` (Split) |
| "ทำ ticket SAM-123 full" | `orchestrator` → fan out |
| "เพิ่ม endpoint GET /proposals" | `dotnet-developer` |
| "สร้าง modal confirm approve" | `frontend-developer` |
| "เขียน test ให้ ApproveHandler" | `tester` |
| "review PR นี้" | `code-reviewer` |
| "ทำไม approval chain ข้าม SDM" | `expert-viewer` |
| "trace flow rebate calculation" | `expert-viewer` |

---

## Hard Rules

- **ba-expert never branches, never writes code, never commits.** Output = markdown + `tasks/<TICKET>/` scaffold only.
- **orchestrator** owns branching + commit hand-off. Specialist agents only edit files.
- Main Claude routes by keyword in user prompt. Auto-invoke ba-expert on any `SAM-NNNN` reference.
- One round of clarifying questions max (especially ba-expert Draft mode).
- Every agent reads `_shared/sam-context.md` first for app stack + paths.

---

## Files

- Agent definitions: `.claude/agents/<name>.md`
- Shared context: `.claude/agents/_shared/sam-context.md`, `sam-conventions.md`, `sam-ba-context.md`, `sam-paths.md`
- Task scratchpads: `tasks/<TICKET>/plan.md` + `progress.md`
- Feature docs: `.claude/docs/features/` (feature-specific business rules)
