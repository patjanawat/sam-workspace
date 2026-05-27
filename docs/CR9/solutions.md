# CR#9 Delegate after PTE Removed — Solution Options

**Related:** [impact-analysis.md](impact-analysis.md), [flows.md](flows.md), [code-changes.md](code-changes.md)

**Bundled with:** CR8 (PTE removal) — same release window

---

## Solution A — Bundle w/ CR8, Hard Cutover + Auto-Convert

**Approach:** Same PR + release as CR8. Migration SQL converts active `UserDelegate` rows `SDM → PTE` to `SDM → CDR`. Cancel `PTE → *` rows.

**Pros:**
- Single deploy, no intermediate broken state
- Users keep delegate intent (auto-routed to CDR)
- Validator enforces strict post-cutover state

**Cons:**
- Assumes SDM intended CDR — may not be true (PTE was a specific role)
- Migration risk if rows corrupt or assumption wrong

**Effort:** 3.5d (shared w/ CR8)

---

## Solution B — Bundle w/ CR8, Cancel + Notify  *(recommended)*

**Approach:** Same PR + release. Migration cancels ALL `SDM → PTE` active rows. Email sdm users: "re-create delegate to CDR".

**Pros:**
- No silent re-route — explicit user consent
- Safer audit trail
- Lower migration risk
- Aligns w/ meeting note "delegate ใช้น้อยมาก" (low row count = low notify burden)

**Cons:**
- sdm user friction (manual re-create)
- Gap period: delegate inactive until user acts
- Email infra dependency

**Effort:** 3.7d (+0.2d for notification)

---

## Solution C — Phased: CR8 First, CR9 Next Release

**Approach:** CR8 ships alone removing PTE approver step. CR9 ships next release with delegate target swap.

**Pros:**
- Smaller blast radius per deploy
- Easier rollback per change

**Cons:**
- **Broken state between releases** — UI offers SDM→PTE but PTE removed = invalid delegate
- Validator must temporarily allow garbage
- More coordination overhead
- Double release notes

**Effort:** 4.5d (overhead + temp guards)

---

## Solution D — Feature Flag Toggle

**Approach:** Bundle w/ CR8 but gate mapping behind a flag. Flip flag post-deploy after smoke test.

**Pros:**
- Instant rollback via flag
- Production validation before commit

**Cons:**
- Flag infra cost (no existing flag system in SAM)
- Dead code after stable
- Migration timing complex (when to convert rows?)

**Effort:** 5d+ (flag scaffolding)

---

## Recommendation: **Solution B**

**Reasoning:**
1. Meeting note "delegate ใช้น้อยมาก ไม่เคยใช้" = near-zero active rows → notification burden minimal
2. Explicit user re-creation = clean audit trail, no silent re-route to wrong role
3. Avoids assumption "SDM wanted CDR" — user picks intent explicitly
4. Same release window w/ CR8 = no broken intermediate state (kills Solution C)
5. No flag infra needed (kills Solution D)
6. Cost delta vs Solution A = +0.2d for safety win

**Fallback:** If active row count = 0 (likely per meeting), Solution A and B converge — ship Solution B template without notify step.

---

## Decision Gate

**Before implementation:**
1. Query `UserDelegate` active rows where `FromRole = 'sdm' AND ToRole = 'pte'`
2. Query `UserDelegate` active rows where `FromRole = 'pte'`
3. Confirm CDR current delegator state with Art (assumption vs reality)

**If row count = 0:** proceed with Solution A (no notify needed).
**If row count > 0:** proceed with Solution B (notify required).
