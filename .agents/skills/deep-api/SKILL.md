---
name: deep-api
description: "Serial recommend+brief every working-item ticket for a feature, then multitask implement (tdd / deepen); mark each shipped ticket deepened-with-api."
disable-model-invocation: true
---

# Deep API

One **feature**. **Audit** the whole board before any implementation. Stay in **one serial orchestrator** through recommend+brief for **every** working-item ticket. Only then **multitask** implementers. Ship the **API lane** only: close **gaps** with `tdd`, deepen **holds** with `improve-codebase-architecture` recommendations locked into briefs. Every working-item ticket gets work—never skipped. Every ticket strengthens **unit** and **integration** tests at its agreed **seams**. Mark each finished ticket `deepened-with-api`.

Ticket triage/`Status` is not evidence. Only code and green tests are.

UI work is out of this skill—use `/deep-ui` or `/checkmate` when surfaces need chrome.

## Steps

### 1. Resolve the feature

The user names a spec (`.specs/NN-….md`), a feature/spec parent issue, or an implementation issue. Resolve the **feature**: every open/closed `implementation` sub-issue of the matching GitHub feature parent (`area:<slug>`). See `docs/agents/issue-tracker.md`.

Exclude wayfinder decision tickets (`research` / `grilling` / `prototype`) and `wontfix` from the board—they are not working items.

For each working-item ticket, record: number, title, triage labels, `Blocked by:`, acceptance checklist, linked `.specs/` story, and whether acceptance is API/backend-facing (routes, modules, policies, persistence, CLI).

**Done when:** the full working-item list for the feature is loaded.

### 2. Audit every ticket (no code changes)

For **each** ticket, for **every** acceptance item, probe the codebase and classify:

- **holds** — behaviour exists at a public seam; name proving files/routes/tests
- **gap** — missing, partial, or contradicted by code (Closed/`done` on the ticket is still a **gap** if probes fail)
- **n/a** — only with a one-line rationale

Also grade tests for that ticket:

- **unit coverage** — present / thin / missing at the module seam
- **integration coverage** — present / thin / missing at the route or package seam

Source of truth: the ticket and linked spec—not stale "Implementation Gaps" prose in specs.

If a ticket's blockers are not Closed/`done`/`resolved`, mark the ticket **blocked** (not a gap to close yet).

**Hard gate:** finish the entire board before step 5. No tests written, no refactors, no commits, no implementer agents in this step.

**Done when:** every ticket on the feature has a full acceptance classification and a unit/integration grade.

### 3. Show the board

Present one table covering **all** tickets:

| Ticket | Ticket status | Board | Unit | Integration | Notes |
|--------|---------------|-------|------|-------------|-------|
| … | Open/Closed + triage | holds / gap / blocked | present / thin / missing | present / thin / missing | pointers or blocker ids |

Summarize counts: holds, gaps, blocked, deferred; and how many tickets need unit and/or integration work.

**Done when:** the user has seen the full board.

### 4. Agree the ship plan (questions before recommend)

Every working-item ticket on the board gets **one or more** implementation tasks. Nothing is skipped.

Assign tasks from the board verdict:

| Board | Required tasks |
|-------|----------------|
| **gap** (unblocked) | `tdd` (required): red → green at API seams; add or harden **unit** and **integration** tests for that ticket's acceptance. |
| **holds** | `improve-codebase-architecture` recommend (required), then `tdd` reimplement so acceptance stays green; deepen **unit** and **integration** where coverage was thin/missing. |
| **deferred** | Promote on the plan to **gap** or **holds** treatment above (user picks Close vs Deepen); still receives the same required tasks—deferred is not a skip. |
| **blocked** | Queue behind blockers; when unblocked, assign gap or holds tasks as above. Do not implement around open blockers. |

Ask before locking the plan:

1. Confirm public **seams** per ticket (module interfaces, HTTP/CLI routes, persistence adapters).
2. Confirm Close vs Deepen for every **deferred** ticket.
3. Confirm auto-pick of `improve-codebase-architecture` **Top recommendation** vs pause-for-pick on each **holds** ticket.
4. Confirm commit message prefix / branch (default: current branch; one commit per ticket).
5. Confirm multitask waves: which tickets may run in parallel (no shared files / no open blockers) vs must wait.

List seams and the task list (`tdd` / `improve-codebase-architecture`) per ticket. Confirm with the user.

**Done when:** every working-item ticket has ≥1 assigned implementation task, seams and test levels are confirmed, questions are answered, blocked tickets have an explicit unblock order, and parallel waves are named.

### 5. Recommend and brief (serial orchestrator — all tickets)

Stay in **this** agent. Produce recommendations and an **implementation brief** for **every** planned ticket before any implementer starts. Do not multitask this step. Do not write production code or tests here.

For each ticket, in board order (respect blockers):

#### Gap brief

Write a brief that names: ticket number, Close, agreed seams, acceptance items to prove, unit + integration files to add/harden, and the first failing test to write.

#### Holds brief

1. Call the Skill tool with `improve-codebase-architecture`, scoped to the files/modules that prove this ticket's acceptance (YAGNI: that ticket's hot paths only).
2. Record candidates; lock the user's pick, or the report's **Top recommendation** if they authorized auto-pick on the ship plan.
3. Fold the locked deepening into the brief: target **module** / **interface** / **seam**, files in scope, tests that must stay green, unit + integration to deepen where the audit graded thin/missing.

Persist each brief where implementers can reach it (issue comment and/or a throwaway notes path outside the merge path). Prefer **context pointers** (ticket URL, brief path, seam paths)—do not paste the whole codebase into later prompts.

**Hard gate:** every planned ticket has a locked brief before step 6. No implementer Task until this step is done.

**Done when:** every planned ticket has a written brief, holds tickets have a locked recommendation, and the user has confirmed the full brief set (or auto-pick was already authorized).

### 6. Multitask implement (only after every brief is locked)

The serial orchestrator **delegates** implementation. Launch **Task** implementer agents with multitask: one agent per ticket in the current wave; use `run_in_background: true` when Multitask Mode is on. Fire an entire wave in **one** message (multiple Task calls together). Never start an implementer for a ticket that was not on the step-2 board or lacks a step-5 brief. Never finish the feature with a ticket that received no brief.

Each implementer prompt carries: its brief pointer, repo path, branch, commit protocol, required skills (`tdd`; `codebase-design` vocabulary for holds), and the instruction to mark `deepened-with-api` when its verify step passes. Implementers execute the brief—they do not re-run board-wide audit or `improve-codebase-architecture` discovery.

#### Close (gap) — implementer

1. Call the Skill tool with `tdd`. Red → green at the agreed API seams. One test, then only enough code to pass, repeat.
2. Cover acceptance with **both** unit and integration tests at those seams (add the missing layer when the audit marked it thin/missing).
3. Keep domain vocabulary aligned with `GLOSSARY.md` and ADRs.

#### Deepen (holds) — implementer

1. Reimplement the **locked** deepening with `tdd` at the agreed seams. Acceptance that **holds** must stay green—deepen depth, do not drop behaviour.
2. Strengthen **unit** and **integration** where the brief says thin/missing.

When a wave finishes, start the next unblocked wave the same way. Shared-file tickets stay in separate waves.

**Done when:** every planned ticket's brief is executed with green unit and integration tests at its agreed seams (blocked tickets only after their blockers clear).

### 7. Verify, mark, commit, push (per ticket)

As each implementer finishes—or the orchestrator closes out a ticket after a wave:

1. Re-run that ticket's focused unit and integration tests; typecheck (or package equivalent) for touched packages. Fix failures before shipping.
2. Ensure label `deepened-with-api` exists (`gh label create deepened-with-api --description "API lane deepened (deep-api)" --color 0E8A16` if missing). Apply it: `gh issue edit <N> --add-label deepened-with-api`.
3. Comment on the issue: audit verdict, Close vs Deepen, brief pointer, seams, and proving test/file paths. Close the issue when acceptance fully holds; leave open when only the API lane shipped and more lanes remain.
4. Commit following the repo's git commit protocol—**one commit per shipped ticket** (message names `feature/NN-slug` and why). Push the current branch (`git push -u origin HEAD` if upstream is missing). Never `--force` to `main`/`master`. Never skip hooks unless the user said so in this turn.

**Done when:** every planned ticket carries `deepened-with-api`, its issue comment matches the code, commits are on the remote, and the working tree for shipped files is clean.

## Out of scope

- Implementing or multitasking implementers before every planned ticket has a locked brief
- Multitasking the recommend+brief step
- Leaving any working-item ticket without a `tdd` and/or `improve-codebase-architecture` task and brief
- UI implementation (`ui-ux-pro-max`)—hand that lane to `/deep-ui`
- Opening a PR (use `/pr` separately if wanted)
- Wayfinder decision tickets and `wontfix` — not working items
