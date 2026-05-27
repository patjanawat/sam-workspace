# CR#9 — Delegate after Pricing Team Removed

**Bundled with:** [CR8](../CR8/) (Pricing Team removal) — same release window

## Documents

| Doc | Purpose |
|---|---|
| [impact-analysis.md](impact-analysis.md) | FE/BE impact assessment, file-level breakdown, effort estimate |
| [solutions.md](solutions.md) | 4 solution options + recommendation (Solution B) |
| [flows.md](flows.md) | 6 ASCII flow diagrams (pre/post cutover, auto-approve, migration, validator, UI state) |
| [code-changes.md](code-changes.md) | Step-by-step BE (5 steps) + FE (3 steps) code changes |

## Quick Summary

- **Change:** SDM delegate target swap `PTE → CDR`. PTE removed from delegator + target lists. CDR delegate function deactivated.
- **Recommended solution:** Solution B — bundle w/ CR8, cancel active rows, notify sdm users.
- **Effort:** ~3.5d (FE 0.9d + BE 1.9d + QA 0.7d), shared coordination w/ CR8.
- **Blocker:** Confirm CDR current delegator state w/ Art before merge.
