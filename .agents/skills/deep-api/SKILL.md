---
name: deep-api
description: "Audit every working-item ticket for a feature; close gaps with tdd or deepen holds with improve-codebase-architecture—unit+integration tests required—then commit and push per ticket."
disable-model-invocation: true
---

# Deep API

One **feature**. **Audit** the whole board before any implementation. Then ship the **API lane** only: close **gaps** with `tdd`, deepen **holds** with `improve-codebase-architecture`. Every working-item ticket gets work—never skipped. Every ticket strengthens **unit** and **integration** tests at its agreed **seams**.

Ticket `Status:` is not evidence. Only code and green tests are.

UI work is out of this skill—use `/deep-ui` or `/checkmate` when surfaces need chrome.

## Steps

### 1. Resolve the feature

The user names a spec (`.specs/NN-….md`), a feature slug (`.scratch/<feature>/`), or one ticket under that feature. Resolve the **feature**: every working-item ticket in `.scratch/<feature>/issues/`.

Exclude wayfinder decision tickets (`research` / `grilling` / `prototype`) and `wontfix` from the board—they are not working items.

For each working-item ticket, record: title, `Status:`, `Blocked by:`, acceptance checklist, linked `.specs/` story, and whether acceptance is API/backend-facing (routes, modules, policies, persistence, CLI).

**Done when:** the full working-item list for the feature is loaded.

### 2. Audit every ticket (no code changes)

For **each** ticket, for **every** acceptance item, probe the codebase and classify:

- **holds** — behaviour exists at a public seam; name proving files/routes/tests
- **gap** — missing, partial, or contradicted by code (`done` on the ticket is still a **gap** if probes fail)
- **n/a** — only with a one-line rationale

Also grade tests for that ticket:

- **unit coverage** — present / thin / missing at the module seam
- **integration coverage** — present / thin / missing at the route or package seam

Source of truth: the ticket and linked spec—not stale "Implementation Gaps" prose in specs.

If a ticket's blockers are not `done`/`resolved`, mark the ticket **blocked** (not a gap to close yet).

**Hard gate:** finish the entire board before step 5. No tests written, no refactors, no commits in this step.

**Done when:** every ticket on the feature has a full acceptance classification and a unit/integration grade.

### 3. Show the board

Present one table covering **all** tickets:

| Ticket | Ticket status | Board | Unit | Integration | Notes |
|--------|---------------|-------|------|-------------|-------|
| … | done / ready-for-agent / deferred / … | holds / gap / blocked | present / thin / missing | present / thin / missing | pointers or blocker ids |

Summarize counts: holds, gaps, blocked, deferred; and how many tickets need unit and/or integration work.

**Done when:** the user has seen the full board.

### 4. Agree the ship plan (questions before code)

Every working-item ticket on the board gets **one or more** implementation tasks. Nothing is skipped.

Assign tasks from the board verdict:

| Board | Required tasks |
|-------|----------------|
| **gap** (unblocked) | `tdd` (required): red → green at API seams; add or harden **unit** and **integration** tests for that ticket's acceptance. |
| **holds** | `improve-codebase-architecture` (required), then `tdd` reimplement so acceptance stays green; deepen **unit** and **integration** where coverage was thin/missing. |
| **deferred** | Promote on the plan to **gap** or **holds** treatment above (user picks Close vs Deepen); still receives the same required tasks—deferred is not a skip. |
| **blocked** | Queue behind blockers; when unblocked, assign gap or holds tasks as above. Do not implement around open blockers. |

Ask before locking the plan:

1. Confirm public **seams** per ticket (module interfaces, HTTP/CLI routes, persistence adapters).
2. Confirm Close vs Deepen for every **deferred** ticket.
3. Confirm auto-pick of `improve-codebase-architecture` **Top recommendation** vs pause-for-pick on each **holds** ticket.
4. Confirm commit message prefix / branch (default: current branch; one commit per ticket).

List seams and the task list (`tdd` / `improve-codebase-architecture`) per ticket. Confirm with the user.

**Done when:** every working-item ticket has ≥1 assigned implementation task, seams and test levels are confirmed, questions are answered, and blocked tickets have an explicit unblock order.

### 5. Implement (only after the board and plan)

Run confirmed workstreams. Prefer **serial per ticket** when commits must stay one-ticket-clean; use parallel subagents only when the plan says tickets do not share files. Never start a workstream for a ticket that was not on the step-2 board. Never finish the feature with a ticket that received no implementation task.

#### Close (gap)

1. Call the Skill tool with `tdd`. Red → green at the agreed API seams. One test, then only enough code to pass, repeat.
2. Cover acceptance with **both** unit and integration tests at those seams (add the missing layer when the audit marked it thin/missing).
3. Keep domain vocabulary aligned with `GLOSSARY.md` and ADRs.

#### Deepen (holds)

1. Call the Skill tool with `improve-codebase-architecture`, scoped to the files/modules that prove this ticket's acceptance (YAGNI: that ticket's hot paths only).
2. Present candidates; take the user's pick, or the report's **Top recommendation** if they authorized auto-pick on the ship plan.
3. Reimplement the deepening with `tdd` at the agreed seams. Acceptance that **holds** must stay green—deepen depth, do not drop behaviour.
4. Strengthen **unit** and **integration** where the audit graded thin/missing.

Do not bulk-write all tests first. Do not expand past the ticket. Do not start UI work under this skill.

**Done when:** the ticket's assigned tasks are complete with green unit and integration tests at its agreed seams.

### 6. Verify, close, commit, push (per ticket)

After each shipped ticket:

1. Re-run that ticket's focused unit and integration tests; typecheck (or package equivalent) for touched packages. Fix failures before shipping.
2. Update the ticket file: `Status: done` when acceptance fully holds; check every acceptance box that holds; append `## Comments` with audit verdict, Close vs Deepen, seams, and file pointers.
3. Commit following the repo's git commit protocol—**one commit per shipped ticket** (message names `feature/NN-slug` and why). Push the current branch (`git push -u origin HEAD` if upstream is missing). Never `--force` to `main`/`master`. Never skip hooks unless the user said so in this turn.

Then move to the next unblocked ticket on the plan.

**Done when:** every planned ticket is shipped, its ticket file matches the code, commits are on the remote, and the working tree for shipped files is clean.

## Out of scope

- Implementing before the full-feature board is shown and the ship plan confirmed
- Leaving any working-item ticket without a `tdd` and/or `improve-codebase-architecture` task
- UI implementation (`ui-ux-pro-max`)—hand that lane to `/deep-ui`
- Opening a PR (use `/pr` separately if wanted)
- Wayfinder decision tickets and `wontfix` — not working items
