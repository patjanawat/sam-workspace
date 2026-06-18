# cr-analyst — Usage & Trigger Cheatsheet

How to invoke the `cr-analyst` agent and what each mode does. Agent definition:
[`cr-analyst.md`](cr-analyst.md). Routing rules: [`AGENT_TRIGGERS.md`](AGENT_TRIGGERS.md).

`cr-analyst` owns the `docs/CR<N>/` change-request document set — the spec doc
and `impact-analysis.md`. It is **read-only on `web/`**, never branches, never
commits. It produces/maintains CR markdown (and regenerates rendered HTML).

---

## Modes at a glance

| Mode | Use when | Output |
|---|---|---|
| **A — Analyze** | Sources exist (spec / meeting / requirement) but `impact-analysis.md` missing or stale | Produce/refresh `docs/CR<N>/impact-analysis.md` per template |
| **B — Reconcile** | A decision was made and spec + impact-analysis disagree | Propagate the decision to **every** superseded section in both docs + update Decisions table |
| **C — Audit** | Want to find drift in an existing CR doc set | One-line findings table — stale policy, unestimated scope, broken anchor, naming drift |

---

## Mode A — Analyze (sources → impact-analysis.md)

Build/refresh the impact analysis from spec + meeting + a real code scan.

| Prompt | Result |
|---|---|
| `วิเคราะห์ CR3 ทำ impact analysis` | scan CR3 sources → write `docs/CR3/impact-analysis.md` |
| `ทำ impact analysis CR8 จาก meeting + spec` | read meeting/spec/code → fill template |
| `CR impact analysis สำหรับ CR5` | Mode A |
| `analyze CR4 impact` | Mode A |
| `impact-analysis.md CR9 ยังไม่มี ช่วยสร้าง` | scaffold new |

## Mode B — Reconcile (decision → propagate)

A new meeting/PO decision exists → grep the old policy and fix **every** section
that contradicts it (Proposed Solution, Risks, Rollback, Monitoring, Metrics,
AC, Estimate), then update the `Decisions (supersedes spec §)` table.

| Prompt | Result |
|---|---|
| `reconcile CR1 spec กับ meeting ล่าสุด` | grep old policy → patch all sites + Decisions table |
| `meeting decision CR6: fallback เปลี่ยนเป็น error — propagate` | Mode B |
| `sync spec CR2 ให้ตรง decision` | Mode B |
| `propagate decision CR7 ลง impact-analysis` | Mode B |
| `อัพเดท CR5 ตามมติ PO` | Mode B |

## Mode C — Audit (find drift)

Scan the whole CR doc set for contradictions, uncosted scope, broken anchors,
naming drift. Returns a severity-tagged findings table (🚨/⚠️/🟡/ℹ️).

| Prompt | Result |
|---|---|
| `ตรวจ CR2 doc หา issue` | findings table |
| `audit CR4 doc` | Mode C |
| `review CR doc CR8` | Mode C |
| `CR3 drift มีไหม` | Mode C |
| `หา issue ใน docs/CR6/impact-analysis.md` | Mode C |

## Proactive trigger (no verb needed)

Just referencing a CR routes to cr-analyst (mode inferred from context).

| Prompt | Result |
|---|---|
| `docs/CR1/impact-analysis.md` | open + route cr-analyst |
| `CR2` | proactive → cr-analyst |
| `เปิด CR5 หน่อย` | proactive |
| `CR7 เป็นไง` | proactive |

---

## cr-analyst vs ba-expert (don't cross them)

| Artifact | Agent | Trigger key |
|---|---|---|
| `docs/CR<N>/` change request | **cr-analyst** | `CR1`, `วิเคราะห์ CR`, `audit CR`, `docs/CR` |
| `tasks/<TICKET>/` Jira ticket | **ba-expert** | `SAM-1234`, `วิเคราะห์ SAM-`, `scaffold ticket` |

The split is **CR vs SAM-NNNN**. A `SAM-NNNN` reference → ba-expert; a `CR<N>`
or `docs/CR<N>/` reference → cr-analyst.

---

## Caveats

- Triggers are **description keywords** that main Claude reads to route — not a
  hard regex. A bare `วิเคราะห์` can collide with `expert-viewer` / `ba-expert`.
  Include an explicit `CR<N>` to disambiguate.
- cr-analyst **never** touches `web/`, branches, or commits — it surfaces the
  diff; you decide. (See [`cr-analyst.md`](cr-analyst.md) § Never.)
- Every CR doc must follow the template
  [`docs/_templates/impact-analysis.md`](../../docs/_templates/impact-analysis.md)
  and the CLAUDE.md § CR Docs Convention.
