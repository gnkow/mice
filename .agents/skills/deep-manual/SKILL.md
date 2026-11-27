---
name: deep-manual
description: "Audit a feature's tickets, dependency-sort them, then process each serially through API → UI → browser manual review → test hardening."
disable-model-invocation: true
---

# Deep Manual

One **feature**. **Audit** the whole board before any implementation. **Sort** working-item tickets by `Blocked by:` dependencies. Process tickets **serially**. Each ticket runs four **phases**: API (`/deep-api` lane) → UI (`/deep-ui` lane) → **manual** browser review → **tests**.

Phases 1 and 2 may be a **noop** (nothing to change) and still count as complete. **Phase 3 is always required**—never a noop. Ticket `Status:` is not evidence. Only code, green tests, and a completed manual review are.

Lane authority lives in the sibling skills—do not restate their Close/Deepen recipes here:

- Phase 1: read and follow [`.agents/skills/deep-api/SKILL.md`](../deep-api/SKILL.md) implement/verify rules for **this ticket only**
- Phase 2: read and follow [`.agents/skills/deep-ui/SKILL.md`](../deep-ui/SKILL.md) implement/verify rules for **this ticket only**

Do **not** re-run those skills' full-board audit inside a phase; this skill's board is the source of truth for order and scope.

## Steps

### 1. Resolve the feature

The user names a spec (`.specs/NN-….md`), a feature/spec parent issue, an implementation issue, or a subset of tickets. Resolve the **feature**: every open/closed `implementation` sub-issue of the matching GitHub feature parent (`area:<slug>`). See `docs/agents/issue-tracker.md`.

Exclude wayfinder decision tickets (`research` / `grilling` / `prototype`) and `wontfix` from the board—they are not working items.

For each working-item ticket, record: title, `Status:`, `Blocked by:`, acceptance checklist, linked `.specs/` story, API-facing seams (routes, modules, policies, persistence, CLI), and UI surfaces (page, route chrome, form, dialog, empty/error states, or operator-visible flow).

If the user named a subset, still load the full feature for dependency context; mark out-of-scope tickets as **deferred-this-run** (not skipped forever).

**Done when:** the full working-item list for the feature is loaded.

### 2. Audit every ticket (no code changes)

For **each** ticket, for **every** acceptance item, probe the codebase and classify on **both** lanes:

**API**

- **holds** — behaviour exists at a public seam; name proving files/routes/tests
- **gap** — missing, partial, or contradicted by code (`done` on the ticket is still a **gap** if probes fail)
- **n/a** — only with a one-line rationale (no API surface)

**UI**

- **holds** / **gap** / **n/a** / **no-ui** — same rules as `/deep-ui`

Also grade tests:

- **unit** — present / thin / missing
- **integration** — present / thin / missing
- **e2e** — present / thin / missing / n/a (n/a when **no-ui**)

Source of truth: the ticket and linked spec—not stale "Implementation Gaps" prose in specs.

If a ticket's blockers are not `done`/`resolved`, mark the ticket **blocked** (not a gap to close yet).

**Hard gate:** finish the entire board before step 5. No tests written, no refactors, no UI edits, no commits in this step.

**Done when:** every ticket has API + UI acceptance classification and unit/integration/e2e grades.

### 3. Show the board and dependency order

Present one table covering **all** tickets:

| Ticket | Ticket status | API | UI | Unit | Int | E2E | Blocked by | Notes |
|--------|---------------|-----|----|------|-----|-----|------------|-------|
| … | done / ready-for-agent / deferred / … | holds / gap / n/a | holds / gap / no-ui / n/a | … | … | … | #ids or — | pointers |

Then present the **serial queue**: a topological order of unblocked tickets (and blocked tickets queued behind their blockers). Break ties by issue number ascending. Reject cycles—stop and ask the user how to break them.

Summarize counts: API gaps/holds, UI gaps/holds/no-ui, blocked, deferred-this-run; tickets needing unit, integration, and/or E2E work.

**Done when:** the user has seen the full board and the proposed serial queue.

### 4. Agree the ship plan (questions before code)

Every ticket in the serial queue gets the four-phase plan. Assign phase work from the board:

| Lane / phase | When | Work |
|--------------|------|------|
| **Phase 1 API** | API **gap** | `/deep-api` Close: `tdd` at seams; harden unit + integration |
| **Phase 1 API** | API **holds** | `/deep-api` Deepen: `improve-codebase-architecture` (required), then `tdd` reimplement; deepen thin/missing tests |
| **Phase 1 API** | API **n/a** | **noop** — mark phase complete |
| **Phase 2 UI** | UI **gap** | `/deep-ui` Close: `ui-ux-pro-max` + E2E |
| **Phase 2 UI** | UI **holds** | `/deep-ui` Deepen: `ui-ux-pro-max` + strengthen E2E where thin/missing |
| **Phase 2 UI** | UI **no-ui** / **n/a** | **noop** — mark phase complete (record acknowledgment for **no-ui**) |
| **Phase 3 Manual** | **Always** (every queued ticket) | Browser-guided review; implement user feedback. For **no-ui** tickets, open the closest operator-visible path that exercises the ticket (or the entry point the user names on the plan)—still stop and wait for feedback. |
| **Phase 4 Tests** | Always after phases 1–3 for tickets in the queue | Correct and harden unit + integration + E2E for that ticket's seams/surfaces |

**Deferred** tickets the user wants in this run: promote to gap or holds treatment (user picks Close vs Deepen) before entering the queue.

Ask before locking the plan:

1. Confirm the **serial queue** (and any **deferred-this-run** exclusions).
2. Confirm **no-ui** Phase 2 noops (or reclassify if the user disagrees)—Phase 3 still runs.
3. Confirm API **seams**, UI **surfaces**, and Phase 3 browser entry points for **every** ticket (routes, roles, happy path + critical error/empty states; for **no-ui**, the path that exercises the behaviour).
4. Confirm Close vs Deepen for every **deferred** ticket in the queue.
5. Confirm auto-pick of `improve-codebase-architecture` **Top recommendation** vs pause-for-pick on API **holds**.
6. Confirm commit message prefix / branch (default: current branch; **one commit per ticket** after Phase 4).

**Done when:** every queued ticket has an explicit four-phase plan (Phase 3 never noop; Phases 1–2 may name noops), questions are answered, and blocked tickets have an explicit unblock order.

### 5. Process tickets serially (only after the board and plan)

Walk the serial queue **one ticket at a time**. Never start a ticket that was not on the step-2 board. Never start a ticket whose blockers are still open. Never skip Phase 3. Never skip Phase 1 or 2 without recording **noop** or completed work.

For each ticket, run phases 1 → 2 → 3 → 4 in order. Announce the ticket and phase at the start of each phase.

#### Phase 1 — API (`/deep-api` lane)

1. Read `.agents/skills/deep-api/SKILL.md`.
2. Execute that skill's Close or Deepen path for **this ticket only**, using the plan's seams and Close vs Deepen choice.
3. If the plan marked API **noop**, record "Phase 1 noop" and continue—do not invent API work.
4. Prefer `improve-codebase-architecture` on **holds** (YAGNI: this ticket's hot paths only).

**Done when:** API acceptance for this ticket holds (or noop), with green unit/integration at the agreed seams for any code this phase touched.

#### Phase 2 — UI (`/deep-ui` lane)

1. Read `.agents/skills/deep-ui/SKILL.md`.
2. Execute that skill's Close or Deepen path for **this ticket only**, using the plan's surfaces.
3. If the plan marked UI **noop**, record "Phase 2 noop" and continue—do not invent UI work.
4. Do not start unrelated API work here.

**Done when:** UI acceptance for this ticket holds (or noop), with green E2E at the agreed surfaces for any code this phase touched.

#### Phase 3 — Manual (browser)

**Always required.** Human judgment is the product of this phase. Push right: Phase 1 and 2 land before asking the user to look. Never mark this phase noop—even for tickets audited **no-ui**.

1. Open the agreed Phase 3 entry point(s) in the **Cursor browser** (navigate, lock tab, snapshot). Prefer the real running app over mocks. For **no-ui** tickets, use the plan's exercise path (the closest operator-visible way to observe the ticket's behaviour).
2. Brief the user: ticket title, acceptance checklist still in play, routes/roles to use, and what "good" looks like for this ticket.
3. **Stop and wait.** Ask the user to inspect and submit feedback by selecting components / describing what to improve (look, copy, flow, missing behaviour). Do not invent feedback. Do not mark the phase done while waiting.
4. For each feedback item the user accepts as in-scope for this ticket: implement it (`ui-ux-pro-max` for presentation; `tdd` when behaviour changes). Re-snapshot or re-open the surface so they can re-check.
5. Repeat until the user explicitly ends the manual review for this ticket.

**Done when:** the user has explicitly ended the manual review, and every accepted feedback item is implemented.

#### Phase 4 — Tests

Reconcile the suite with everything Phases 1–3 changed—including manual feedback.

1. Re-run focused **unit**, **integration**, and **E2E** for this ticket's seams/surfaces. Fix failures first.
2. Close coverage holes the audit graded thin/missing when this ticket now has behaviour there.
3. Add or adjust tests for behaviour introduced in Phase 3. Prefer the lowest seam that catches the regression; keep E2E for the user-visible path.
4. Typecheck (or package equivalent) for touched packages.

**Done when:** focused unit, integration, and applicable E2E are green for this ticket, and thin/missing grades from the board are addressed or explicitly waived by the user.

### 6. Verify, close, commit, push (per ticket)

After Phase 4 for a ticket:

1. Confirm all four phases are complete (Phases 1–2: work or noop; Phase 3: user-ended review; Phase 4: green tests).
2. Update the ticket: `Status: done` when acceptance fully holds; check every acceptance box that holds; append `## Comments` with audit verdicts (API + UI), Close vs Deepen, phase outcomes (Phases 1–2 noops if any), manual feedback summary, seams/surfaces, and test pointers.
3. Commit following the repo's git commit protocol—**one commit per shipped ticket** (message names `feature/NN-slug` and why). Push the current branch (`git push -u origin HEAD` if upstream is missing). Never `--force` to `main`/`master`. Never skip hooks unless the user said so in this turn.

Then advance to the next ticket in the serial queue (re-check blockers if a sibling just closed).

**Done when:** every planned ticket in the queue is shipped, Phase 3 completed with a user-ended review on each, Phase 1–2 noops (if any) recorded in ticket comments, commits are on the remote, and the working tree for shipped files is clean.

## Out of scope

- Implementing before the full-feature board and serial queue are shown and the ship plan confirmed
- Parallel ticket workstreams (this skill is serial by design—use `/checkmate` or `/deep-api`/`/deep-ui` alone for lane-only or parallel-friendly runs)
- Skipping Phase 3 for any queued ticket (including **no-ui**)
- Leaving Phase 4 off a queued ticket
- Opening a PR (use `/pr` separately if wanted)
- Wayfinder decision tickets and `wontfix` — not working items

