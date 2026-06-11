# SAM — BA Shared Context

Source of truth for **how SAM writes, scaffolds, and validates Jira stories**, and the conventions a BA agent must honor.

Pair this file with `sam-context.md` (codebase context) and `sam-paths.md` (paths and git ops).

---

## Workflow Position

The BA agent sits **upstream** of the implementation flow:

```
Raw input (chat / Jira description / requirements meeting)
   │
   ▼
ba-expert  ───►  tasks/<TICKET>/issue.txt + plan.md skeleton + AC list
   │
   ▼
orchestrator ───►  branch + code + verify + commit + PR draft
```

BA hands off a **scaffolded task folder** that orchestrator picks up via `fix /tasks/<TICKET>`. BA does **not** branch, write code, or commit.

---

## tasks/<TICKET>/ — File Inventory

The folder lives in the **workspace** (`tasks/<TICKET>/` — absolute: `d:\2026\sam-workspace\tasks\<TICKET>\`, see `sam-paths.md` § Task Scratchpads), is **gitignored**, and never enters the workspace repo.

| File | When created | Owner | Required? |
|---|---|---|---|
| `issue.txt` | At ticket intake | BA (or reporter) | yes — primary source |
| `plan.md` | BA scaffolds skeleton; orchestrator refines | BA + orchestrator | yes — must include `## SIT & Test Plan` section |
| `progress.md` | BA seeds; orchestrator updates `## Log` | BA + orchestrator | yes |
| `review-<YYYYMMDD>-<HHMM>.md` | After code review | code-reviewer | optional |

### Required `plan.md` sections

Every `plan.md` **must** include `## SIT & Test Plan` at the end:

```markdown
## SIT & Test Plan

### SIT Scenarios
| # | Scenario | Steps | Expected Result |
|---|---|---|---|
| SIT-1 | ... | ... | ... |

### Manual Test Checklist
- [ ] golden path
- [ ] edge case
- [ ] regression check
```

---

## SAM Roles (use in `Pre-requisition`)

| Role Code | Role Name | Scope |
|---|---|---|
| `srp` | Sale Representative | สร้าง Proposal ของตนเอง |
| `sam` | Area Sale Manager | อนุมัติระดับ Area + เห็น Proposal ของ subordinates |
| `sdm` | Sale Division Manager | อนุมัติระดับ Division |
| `cdr` | Commercial Director | อนุมัติสูงสุด (async always) |
| `pte` | Pricing Team | ตรวจสอบราคา |
| `fin` | Finance | ตรวจสอบการเงิน |
| `adt` | Auditor | ตรวจสอบ audit (export rebate only) |
| `sla` | Sale Admin | จัดการข้อมูล master (Customer Relations) |
| `adm` | System Admin | จัดการระบบ |

When the role is non-obvious, ask the user. Don't default to "adm".

---

## Subtask Decomposition Patterns

### Pattern A — Proposal / list / table feature

| Tag | Title pattern |
|---|---|
| `[FE]` | Improve list component for `<X>` |
| `[FE]` | Improve design of `<element>` on `<page>` page |
| `[BE]` | GET `<resource>` data endpoint |
| `[QA]` | Prepare Test case |
| `[QA]` | Review Test case |
| `[QA]` | Execute Test case |
| `[SIT]` | Dev environment |

### Pattern B — Form / submission feature

| Tag | Title pattern |
|---|---|
| `[FE]` | `<form name>` form — fields + validation |
| `[BE]` | POST /api/`<resource>` — create endpoint |
| `[BE]` | FluentValidation + auth policy |
| `[QA]` | Prepare / Review / Execute Test case |
| `[SIT]` | Dev environment |

### Pattern C — Bug fix

| Tag | Title pattern |
|---|---|
| `[FE]` or `[BE]` | Fix `<symptom>` in `<area>` |
| `[QA]` | Verify fix + regression check |

### Pattern D — Approval / workflow feature

| Tag | Title pattern |
|---|---|
| `[FE]` | Approval UI — add `<new flow>` |
| `[BE]` | New endpoint for `<action>` |
| `[BE]` | Approval handler update |
| `[QA]` | Prepare / Review / Execute Test case |
| `[SIT]` | Dev environment |

**Always include at least one `[QA]` subtask** for any Story going to a release.

---

## Naming Conventions

### Branches

| Type | Pattern | Example |
|---|---|---|
| Feature | `feature/SAM-XXXX-short-description` | `feature/SAM-123-approval-bulk-action` |
| Bug | `bugfix/SAM-XXXX-short-description` | `bugfix/SAM-456-proposal-status-reset` |
| Hotfix | `hotfix/SAM-XXXX-short-description` | `hotfix/SAM-789-cdr-timeout` |
| Refactor | `refactor/short-description` | `refactor/extract-approval-service` |
| Chore | `chore/short-description` | `chore/bump-dotnet-10` |

Branch always from `develop`. Never from `main` or `master`.

---

## Acceptance Criteria — Quality Bar

Every AC must pass these checks:

| Check | Bad | Good |
|---|---|---|
| Observable | "Page looks correct" | "Page displays N proposals ordered by Created DESC" |
| Testable | "System handles error gracefully" | "On 500 from /api/proposals, toast shows error and retry button is enabled" |
| No weasel words | "Approval works appropriately" | "When SAM approves, ProposalStatus changes to Pending(2) and SDM step becomes active" |
| State both sides | "User can reject" | "When user clicks Reject and confirms, Proposal status changes to Rejected(4) and rejection reason is saved" |
| Numbered AC1..ACn | mixed bullets | `AC1`, `AC2`, … strictly sequential |

### Gherkin AC Format (mandatory for runtime-behavior tickets)

Every AC for tickets with runtime behavior must use **Given / When / Then** table:

```markdown
| # | Given | When | Then |
|---|---|---|---|
| AC1 | SAM user is on Approval page with 3 pending Proposals | SAM clicks Approve on one Proposal and API returns 2xx | Proposal status changes to Approved(3); remaining 2 still pending; success toast shown |
```

**Exemption:** Tickets tagged `[DOC]` or `[CHORE]` with no runtime behavior may use a bullet checklist.

### Common edge cases for SAM list/table tickets

- Empty state (no proposals)
- All proposals in period closed (CloseMonth)
- Role-based visibility (srp sees only own, sam sees subordinates)
- Filter that hides every row
- Loading state (skeleton or spinner)
- Network error (5xx)
- Approval already processed (optimistic lock conflict)

### Common edge cases for form/modal tickets

- Required field validation messages
- Submit disabled when invalid
- Server validation error display (per-field + form-level)
- Cancel discards changes
- RowVersion mismatch (concurrent edit)
- Temp proposal auto-deleted scenario
- CloseMonth period locked

---

## Severity / Impact Matrix

Score each axis; overall Severity = highest band hit on any axis.

| Axis | Low | Medium | High | Critical |
|---|---|---|---|---|
| **Blast radius** | single user | one role | multiple roles | all users / wrong data persisted or synced |
| **Frequency** | rare edge case | weekly | daily | every use of the feature |
| **Workaround** | trivial | inconvenient | painful (manual data fix) | none — flow blocked |

| Severity | Meaning | SAM examples |
|---|---|---|
| **Critical** | Flow blocked, or wrong data persisted/synced | Approved Proposal syncs wrong price to SAP; CloseMonth locks wrong month |
| **High** | Core flow degraded; workaround painful | Approval chain skips `sdm` step; rebate calc wrong for one CustomerGroup |
| **Medium** | Feature wrong but flow continues | Wrong sort order; filter not persisted |
| **Low** | Cosmetic / rare edge | Label typo; misaligned column |

**Floor rule:** anything touching approval chain, SAP sync, CloseMonth, or rebate calculation starts at **High** minimum.

---

## Page / Menu Navigation — Common SAM Entries

| Page | Route area | Audience |
|---|---|---|
| Proposal List (My Requests) | `/requests` | `srp`, `sam`, `sdm`, `cdr` |
| Create Proposal | `/requests/create` | `srp` |
| Proposal Detail | `/requests/{id}` | varies by role |
| Approval List | `/approvals` | `sam`, `sdm`, `cdr`, `pte`, `fin` |
| Customer Group | `/customers/groups` | `sla`, `adm` |
| Rebate | `/rebates` | `fin`, `adt` |
| SAP Sync | `/sap-sync` | `adm`, `sla` |
| User Management | `/users` | `adm` |

When a ticket lacks navigation info, ask. Don't guess.

---

## Output Conventions

When BA agent produces a ticket markdown:

- Use `---` between top-level sections
- Tables use `| --- |` separator
- Code blocks for branch names, file paths, payload examples
- File paths use backticks: `web/web/backend/SamApp.WebApi/Features/Proposal/`
- SAM ticket references: `SAM-123` (plain text — Jira renders the link)
- Names use `Full Name (Nickname)` form
- Emoji headers for visual landmarks (same as plan.md Tiered template)

---

## plan.md — Tiered Section Model

### Core (mandatory — every ticket)

1. `# SAM-XXXX — <title>`
2. `## 🎯 TL;DR` — 6-row table (Problem / Actual / Expected / Root Cause / Solution / Impact)
3. `## 📖 Problem Statement`
4. `## 🔄 Actual vs Expected`
5. `## 🧮 Complexity Estimate` — SP recommendation + CERT scores
6. `## ✅ Acceptance Criteria` — Gherkin table
7. `## 🚫 Out of Scope`
8. `## 👥 Stakeholders`
9. `## 🧪 SIT & Test Plan`

### Optional (turn on by trigger)

| Section | Turn on when… |
|---|---|
| `## 🔍 Root Cause Analysis` (5 Whys) | Type=Bug, or Improvement with misbehavior |
| `## 🔁 Reproduction Steps` | Type=Bug |
| `## 📊 Impact` | Severity ≥ High or multi-user blast radius |
| `## ⚠️ Risks & Mitigations` | Touches data migration, approval chain, SAP sync, breaking API |
| `## 🔗 Dependencies` | Has blocked-by / blocks / related tickets |
| `## 📎 Evidence` | Reporter attached screenshots, logs |
| `## 💡 Solution Options` | ≥ 2 viable approaches with different business trade-offs — 2–3 options, trade-offs, recommendation marked; PO decides |
| `## 📋 Definition of Ready (DoR)` | Story going into release sprint |
| `## ✔️ Definition of Done (DoD)` | Story going into release sprint |
| `## 🏗️ Approach` (TBD by orchestrator) | Always present as placeholder |
| `## 📁 Files Likely Affected` (TBD) | Always present as placeholder |

---

## Bilingual Plan Convention

SAM's plan.md is **bilingual by section, not by line**.

### Default language matrix

| Section | Language | Why |
|---|---|---|
| All headings | EN | Stable anchors; scans fast |
| 🎯 TL;DR | EN + TH side-by-side (3-col) | PO reads TH; devs/QA read EN |
| 📖 Problem Statement | TH | Narrative; reporter writes TH |
| 🔄 Actual vs Expected | TH | UX steps; team discusses in TH |
| 🔁 Reproduction Steps | TH | Reporter-authored; usually TH |
| 🔍 Root Cause Analysis | TH | Causal reasoning; clearer in native |
| 📊 Impact | EN | Structured matrix |
| ✅ Acceptance Criteria | EN | QA copies verbatim; must stay stable |
| 🚫 Out of Scope | EN | Structured list |
| ⚠️ Risks & Mitigations | EN | Structured table |
| 🔗 Dependencies | EN | Ticket IDs, links |
| 👥 Stakeholders | EN | Names in Full Name (Nickname) form |
| 🏗️ Approach | EN | Code identifiers |
| 📁 Files Likely Affected | EN | File paths |
| 🧮 Complexity Estimate | EN | CERT scores; comparable past tickets |
| 🧪 SIT & Test Plan | EN | QA artefact; must match AC strings |
| 📋 DoR / ✔️ DoD | EN | Standard checklists |

---

## Story Point Estimation (Planning Poker)

**Deck:** `0 | 1 | 2 | 3 | 5 | 8 | 13 | 20+ (split) | ? (missing info)`

No `½` card — backward compat with existing Jira velocity history.

### 30-second decision tree

1. Read AC + scope → estimate file surface area
2. Score CERT: Complexity / Effort / Risk / Tested-path uncertainty (each 1–5)
3. Pick card per mapping table
4. If R = 5: never go below 5 SP
5. State confidence: High / Medium / Low
6. Cite a comparable past SAM ticket from the Calibration Log (below); if log is empty, say "no comparable — first calibration entry"

### Calibration Log

`tasks/_history/estimates.md` — one row per estimated ticket:

```markdown
| Ticket | SP | CERT (C/E/R/T) | Confidence | Actual outcome |
|---|---|---|---|---|
| SAM-1234 | 5 | 3/3/4/2 | Medium | TBD |
```

- ba-expert appends a row at estimate time (`Actual outcome` = TBD)
- `Actual outcome` updated at ticket close (orchestrator or user) — e.g. `as estimated`, `overshot — was 8`, `split`
- This log is the source for "comparable past ticket" in step 6 — estimates calibrate over sprints

### CERT Mapping

| Max(C,E,R,T) | Avg(C,E,R,T) | Recommended SP |
|---|---|---|
| 1 | 1.0 | 1 |
| 2 | 1.0–1.5 | 1 |
| 2 | 1.5–2.0 | 2 |
| 3 | 2.0–2.5 | 3 |
| 4 | 2.5–3.0 | 5 |
| 4 | 3.0–3.5 | 8 |
| 5 | 3.5–4.0 | 13 |
| 5 | 4.0+ | 20+ → **split** |

### CERT Factors

| Factor | Question |
|---|---|
| **C — Complexity** | How hard is the logic? (Approval chain, RowVersion, async Hangfire = high) |
| **E — Effort** | How much code surface? (Schema migration + BE + FE + tests = high) |
| **R — Risk** | Blast radius if wrong? (Approval flow, SAP sync, CloseMonth = high) |
| **T — Tested-path uncertainty** | How unknown is the territory? (New integration = high) |

---

## Quality Frameworks Quick Check

| Framework | Question |
|---|---|
| **5W1H** | Who affected / What goes wrong / When / Where in app / Why matters / How reproduced |
| **INVEST** | Independent / Negotiable / Valuable / Estimable / Small (≤13 SP) / Testable |
| **SMART** | Specific / Measurable / Achievable / Relevant / Time-bound |
| **Gherkin** | Every AC has explicit Given, single When, observable Then |

---

## What the BA Agent Does NOT Do

- Does not branch, write code, or commit — orchestrator's job
- Does not assume a role — ask when ambiguous
- Does not pad AC count — each AC must be load-bearing
- Does not edit closed/Done tickets unless explicitly asked
- Does not write into `web/` (code repo) — BA outputs live in `tasks/<TICKET>/`
