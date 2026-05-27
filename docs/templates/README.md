# CR Document Templates

Reusable skeleton + shared stylesheet for SAM Change Request (CR) documents.

## Files

| File | Purpose |
|---|---|
| `CR-template.md` | Canonical markdown skeleton — author here |
| `cr-style.css` | Shared stylesheet for rendered HTML (light + dark + print) |
| `cr-mermaid.html` | Pandoc include — adds Mermaid.js renderer for `flowchart` diagrams |

## How to author a new CR

1. Copy template:
   ```powershell
   Copy-Item docs/templates/CR-template.md docs/CR{N}-{kebab-title}.md
   ```
2. Fill in `{placeholders}` in meta block first.
3. Delete optional sections that don't apply (mark them as N/A in change log instead of leaving empty).
4. Use commit-pinned permalinks for code references, not raw `path:line` — line numbers rot.
   ```
   web/web/backend/.../Foo.cs @ {commit-sha}
   ```
5. Update **Revision History** every meaningful edit.

## Filename convention

```
docs/CR{N}-{kebab-title}.md            (source — author here)
docs/CR{N}-{kebab-title}.html          (rendered artefact — gitignore optional)
```

Examples:
- `CR1-net-freight.md`
- `CR2-project-proposal-management.md`

## Rendering to HTML

### Option A — Pandoc

Install once:

```powershell
winget install --id JohnMacFarlane.Pandoc --source winget
```

Render (run from `docs/` folder):

```powershell
pandoc CR{N}-{kebab-title}.md `
  -f gfm -t html5 `
  --standalone `
  --toc --toc-depth=2 `
  --metadata title="CR#{N} - {Title}" `
  --css templates/cr-style.css `
  --include-after-body templates/cr-mermaid.html `
  -o CR{N}-{kebab-title}.rendered.html
```

Flags explained:
- `-f gfm` — GitHub-flavored markdown (tables, task lists)
- `--toc --toc-depth=2` — auto-generate table of contents
- `--css` — link shared stylesheet (light/dark/print)
- `--include-after-body` — inject Mermaid.js so `flowchart` diagrams render

### Option B — VSCode extension

Use **Markdown Preview Enhanced** or **Markdown All in One** with custom CSS pointing to `templates/cr-style.css`.

### Option C — GitHub / Bitbucket

Markdown renders natively — CSS not applied but content is readable in PRs.

## Section status rules

| Status badge | Meaning |
|---|---|
| Draft | Author still drafting — do not estimate yet |
| In Review | Ready for tech/business review |
| Approved | Greenlit — implementation can start |
| Implemented | Code merged, awaiting release |
| Rejected | Not proceeding — keep for audit trail |

## Quality checklist before "In Review"

- [ ] Meta block complete (owner, sponsor, target release)
- [ ] Mermaid diagrams for Current + Target state
- [ ] Assumptions explicit (≥1 entry, or note "none")
- [ ] Out of Scope explicit (≥1 entry, or note "none")
- [ ] Risk table with mitigation + owner
- [ ] Rollback strategy non-empty (or note "irreversible — and why that's acceptable")
- [ ] Estimate confidence `±%` on every BE/FE row
- [ ] Acceptance criteria checkbox list
- [ ] Open Questions have owner + due date
- [ ] References section has Jira / ticket link
