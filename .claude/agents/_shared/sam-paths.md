# SAM — Filesystem Paths

Single source of truth for all paths, shell commands, and git operations. All agents should read this file.

---

## Repos & Paths

| Repo | Windows path | Note |
|---|---|---|
| **sam-workspace** | `d:\2026\sam-workspace\` | Workspace root — agents, docs, tasks |
| **SAM repo** | `d:\2025\ManaoSoftware\sam\` | Actual codebase — symlinked at `web/` |

`web/` is a **symlink** at workspace root pointing to the SAM repo. All code edits go through `web/`.

---

## SAM Repo — Key Paths

| Path | Purpose |
|---|---|
| `web/web/backend/SamApp.WebApi/` | .NET backend root |
| `web/web/backend/SamApp.WebApi.Tests/` | xUnit test project |
| `web/web/frontend/src/` | Next.js frontend source |

---

## Task Scratchpads

Each ticket's scratchpad lives in the **workspace** — not inside `web/`:

```
d:\2026\sam-workspace\tasks\<TICKET>\
  issue.txt        ← original Jira description
  plan.md          ← evolving plan + SIT & Test Plan
  progress.md      ← phased checklist + Log
  review-*.md      ← code review outputs (code-reviewer agent)
```

Folders are gitignored and never enter the workspace repo.

---

## Backend Commands

```bash
# from workspace root (using web/ symlink)
dotnet run --project web/web/backend/SamApp.WebApi
dotnet test web/web/backend/SamApp.WebApi.Tests/
dotnet test web/web/backend/SamApp.WebApi.Tests/ --filter "FullyQualifiedName~{Feature}"
dotnet test web/web/backend/SamApp.WebApi.Tests/ --logger "console;verbosity=normal"
dotnet ef migrations add {Name} --project web/web/backend/SamApp.WebApi
```

---

## Frontend Commands

```bash
# from workspace root
cd web/web/frontend
npm run dev:local        # local env
npm run dev:development  # dev env
```

---

## Git Operations

Always use `-C web` from workspace root — `web/` is a symlink to the SAM repo:

```bash
git -C web status
git -C web checkout develop
git -C web pull
git -C web checkout -b <type>/SAM-XXX-description
git -C web add .
git -C web commit -m "feat(SAM-XXX): ..."
git -C web push
```

### Branch naming

```
feature/SAM-123-short-description    # new feature
bugfix/SAM-456-short-description     # bug fix
hotfix/SAM-789-short-description     # urgent production fix
chore/short-description              # maintenance, config
refactor/short-description           # code refactor
```

---

## Workspace — Agent & Docs Files

| Path | Purpose |
|---|---|
| `d:\2026\sam-workspace\.claude\agents\` | Agent definitions — edit here |
| `d:\2026\sam-workspace\.claude\agents\_shared\` | Shared context files |
| `d:\2026\sam-workspace\.claude\docs\features\` | Feature-specific docs |
| `d:\2026\sam-workspace\.claude\docs\gotchas.md` | Cross-cutting gotchas |
| `d:\2026\sam-workspace\tasks\` | Per-ticket scratchpads |
