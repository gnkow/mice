---
name: checkmate
description: "Audit every working-item ticket for a spec against code; every ticket gets tdd/ui/improve work—no skips—then commit and push."
disable-model-invocation: true
---

# Checkmate

One **spec**. **Audit** the whole board before any implementation. Then ship: close **gaps**, deepen **holds**. Every working-item ticket gets one or more of `tdd` / `ui-ux-pro-max` / `improve-codebase-architecture`—never skipped.

Ticket `Status:` is not evidence. Only code and green tests are.

## Steps

### 1. Resolve the spec

The user names a spec (`.specs/NN-….md`), a feature/spec parent issue, or an implementation issue. Resolve the **feature**: every open/closed `implementation` sub-issue of the matching GitHub feature parent (`area:<slug>`). See `docs/agents/issue-tracker.md`.

Exclude wayfinder decision tickets (`research` / `grilling` / `prototype`) and `wontfix` from the board—they are not working items.

For each working-item ticket, record: title, `Status:`, `Blocked by:`, acceptance checklist, linked `.specs/` story.

**Done when:** the full working-item list for the feature is loaded.

### 2. Audit every ticket (no code changes)

For **each** ticket, for **every** acceptance item, probe the codebase and classify:

- **holds** — behaviour exists at a public seam; name proving files/routes/tests
- **gap** — missing, partial, or contradicted by code (`done` on the ticket is still a **gap** if probes fail)
- **n/a** — only with a one-line rationale

Source of truth: the ticket and linked spec—not stale "Implementation Gaps" prose in specs.

If a ticket's blockers are not `done`/`resolved`, mark the ticket **blocked** (not a gap to close yet).

**Hard gate:** finish the entire board before step 5. No tests written, no refactors, no commits in this step.

**Done when:** every ticket on the feature has a full acceptance classification.

### 3. Show the board

Present one table (or grouped tables) covering **all** tickets:

| Ticket | Ticket status | Board | Notes |
|--------|---------------|-------|-------|
| … | done / ready-for-agent / deferred / … | holds / gap / blocked | pointers or blocker ids |

Summarize counts: holds, gaps, blocked, deferred.

**Done when:** the user has seen the full board.

### 4. Agree the ship plan

Every working-item ticket on the board gets **one or more** implementation tasks. Nothing is skipped.

Assign tasks from the board verdict:

| Board | Required tasks |
|-------|----------------|
| **gap** (unblocked) | `tdd` (required). Add `ui-ux-pro-max` when the gap needs UI. |
| **holds** | `improve-codebase-architecture` (required), then `tdd` reimplement so acceptance stays green. Add `ui-ux-pro-max` when the deepen touches UI. |
| **deferred** | Promote on the plan to **gap** or **holds** treatment above (user picks Close vs Deepen); still receives the same required tasks—deferred is not a skip. |
| **blocked** | Queue behind blockers; when unblocked, assign gap or holds tasks as above. Do not implement around open blockers. |

List public **seams** (and UI surfaces) and the task list (`tdd` / `ui-ux-pro-max` / `improve-codebase-architecture`) per ticket. Confirm with the user.

**Done when:** every working-item ticket has ≥1 assigned implementation task, seams are confirmed, and blocked tickets have an explicit unblock order.

### 5. Implement (only after the board and plan)

Run confirmed workstreams. Prefer **parallel** subagents—one ticket per workstream—after the plan is locked. Never start a workstream for a ticket that was not on the step-2 board. Never finish the feature with a ticket that received no implementation task.

#### Close (gap)

1. Call the Skill tool with `tdd`. Red → green at the agreed seams. One test, then only enough code to pass, repeat.
2. When the plan assigned UI, call the Skill tool with `ui-ux-pro-max` first, then implement inside existing app chrome and design tokens.
3. Keep domain vocabulary aligned with `GLOSSARY.md` and ADRs.

#### Deepen (holds)

1. Call the Skill tool with `improve-codebase-architecture`, scoped to the files/modules that prove this ticket's acceptance (YAGNI: that ticket's hot paths only).
2. Present candidates; take the user's pick, or the report's **Top recommendation** if they already authorized auto-pick on the ship plan.
3. Reimplement the deepening with `tdd` at the agreed seams. Acceptance that **holds** must stay green—deepen depth, do not drop behaviour.
4. When the plan assigned UI, `ui-ux-pro-max` first, same chrome/tokens rule.

Do not bulk-write all tests first. Do not expand past the ticket.

**Done when:** every working-item ticket has completed its assigned tasks with green tests at its agreed seams (blocked tickets only after their blockers clear).

### 6. Verify green

Re-run focused tests for every shipped ticket, then typecheck (or package equivalent) for touched packages. Fix failures before shipping.

Optionally call the Skill tool with `code-review` on the branch diff if the change set is large; fix blockers it raises.

**Done when:** shipped tickets' tests and typecheck are green.

### 7. Close tickets

For each shipped ticket file:

- Set `Status: done` when acceptance fully holds
- Check every acceptance box that holds
- Append `## Comments`: audit verdict, Close vs Deepen, and file pointers

**Done when:** ticket files match the code.

### 8. Commit and push

Follow the repo's git commit protocol. Prefer **one commit per shipped ticket** (message names `feature/NN-slug` and why). Push the current branch (`git push -u origin HEAD` if upstream is missing). Never `--force` to `main`/`master`. Never skip hooks unless the user said so in this turn.

**Done when:** commits are on the remote and the working tree for shipped files is clean.

## Out of scope

- Implementing before the full-spec board is shown and the ship plan confirmed
- Leaving any working-item ticket without a `tdd` / `ui-ux-pro-max` / `improve-codebase-architecture` task
- Opening a PR (use `/pr` separately if wanted)
- Wayfinder decision tickets and `wontfix` — not working items
