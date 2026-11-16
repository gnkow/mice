---
name: deep-ui
description: "Audit every working-item ticket for a feature; close or deepen UI with ui-ux-pro-max and E2E—inform before skipping non-UI tickets—then commit and push per ticket."
disable-model-invocation: true
---

# Deep UI

One **feature**. **Audit** the whole board before any implementation. Then ship the **UI lane** only: close **gaps** and deepen **holds** with `ui-ux-pro-max`. Every UI-bearing working-item ticket gets work. Every such ticket builds or strengthens **E2E** coverage for its surfaces.

Ticket `Status:` is not evidence. Only code, green E2E, and a usable surface are.

API-only tickets are rare skips: **inform the user and get acknowledgment before skipping**—never silent.

## Steps

### 1. Resolve the feature

The user names a spec (`.specs/NN-….md`), a feature slug (`.scratch/<feature>/`), or one ticket under that feature. Resolve the **feature**: every working-item ticket in `.scratch/<feature>/issues/`.

Exclude wayfinder decision tickets (`research` / `grilling` / `prototype`) and `wontfix` from the board—they are not working items.

For each working-item ticket, record: title, `Status:`, `Blocked by:`, acceptance checklist, linked `.specs/` story, and whether acceptance names a **UI surface** (page, route chrome, form, dialog, empty/error states, or operator-visible flow).

**Done when:** the full working-item list for the feature is loaded.

### 2. Audit every ticket (no code changes)

For **each** ticket, for **every** acceptance item, probe the codebase and classify:

- **holds** — UI behaviour exists at a public surface; name proving components/routes/tests
- **gap** — missing, partial, or contradicted by code (`done` on the ticket is still a **gap** if probes fail)
- **n/a** — only with a one-line rationale
- **no-ui** — acceptance has no user-facing surface (API/CLI/backend-only)

Also grade E2E for that ticket:

- **e2e coverage** — present / thin / missing for the surface

Source of truth: the ticket and linked spec—not stale "Implementation Gaps" prose in specs.

If a ticket's blockers are not `done`/`resolved`, mark the ticket **blocked** (not a gap to close yet).

**Hard gate:** finish the entire board before step 5. No tests written, no UI edits, no commits in this step.

**Done when:** every ticket on the feature has a full acceptance classification and an E2E grade (or an explicit **no-ui** mark).

### 3. Show the board

Present one table covering **all** tickets:

| Ticket | Ticket status | Board | E2E | Notes |
|--------|---------------|-------|-----|-------|
| … | done / ready-for-agent / deferred / … | holds / gap / blocked / no-ui | present / thin / missing / n/a | pointers, surfaces, or blocker ids |

List **no-ui** tickets separately and name them to the user as proposed skips.

Summarize counts: holds, gaps, blocked, deferred, no-ui; and how many tickets need E2E work.

**Done when:** the user has seen the full board, including every proposed **no-ui** skip.

### 4. Agree the ship plan (questions before code)

Every UI-bearing working-item ticket on the board gets **one or more** implementation tasks.

Assign tasks from the board verdict:

| Board | Required tasks |
|-------|----------------|
| **gap** (unblocked, has UI) | `ui-ux-pro-max` (required), then implement inside existing app chrome and design tokens; add or harden **E2E** for that ticket's surfaces. |
| **holds** (has UI) | `ui-ux-pro-max` (required) to deepen the surface; keep acceptance green; strengthen **E2E** where coverage was thin/missing. |
| **deferred** (has UI) | Promote on the plan to **gap** or **holds** treatment above (user picks Close vs Deepen); still receives the same required tasks—deferred is not a skip. |
| **blocked** | Queue behind blockers; when unblocked, assign gap or holds tasks as above. Do not implement around open blockers. |
| **no-ui** | Proposed skip only after the user acknowledges the list. Record the acknowledgment in the plan. |

Ask before locking the plan:

1. Confirm every **no-ui** skip (or reclassify a ticket as UI-bearing if the user disagrees).
2. Confirm UI **surfaces** and E2E entry points per ticket (routes, roles, happy path + critical error/empty states).
3. Confirm Close vs Deepen for every **deferred** UI ticket.
4. Confirm commit message prefix / branch (default: current branch; one commit per ticket).

List surfaces and the task list (`ui-ux-pro-max` + E2E) per ticket. Confirm with the user.

**Done when:** every UI-bearing ticket has ≥1 assigned implementation task, every **no-ui** skip is acknowledged, surfaces and E2E scope are confirmed, and blocked tickets have an explicit unblock order.

### 5. Implement (only after the board and plan)

Run confirmed workstreams for UI-bearing tickets only. Prefer **serial per ticket** when commits must stay one-ticket-clean. Never start a workstream for a ticket that was not on the step-2 board. Never ship a UI-bearing ticket that received no implementation task.

#### Close (gap)

1. Call the Skill tool with `ui-ux-pro-max` first; implement inside existing app chrome and design tokens.
2. Drive behaviour with failing-then-passing **E2E** at the agreed surfaces (Playwright under `e2e/` unless the plan names another harness). One scenario, then only enough UI to pass, repeat.
3. Keep domain vocabulary aligned with `GLOSSARY.md` and ADRs.

#### Deepen (holds)

1. Call the Skill tool with `ui-ux-pro-max`, scoped to the surfaces that prove this ticket's acceptance.
2. Improve the existing UI without dropping acceptance that **holds**.
3. Strengthen **E2E** where the audit graded thin/missing; keep prior E2E green.

Do not bulk-write all E2E first. Do not expand past the ticket. Do not start API-only work under this skill except to unblock a surface already on the plan.

**Done when:** the ticket's assigned tasks are complete with green E2E at its agreed surfaces.

### 6. Verify, close, commit, push (per ticket)

After each shipped UI ticket:

1. Re-run that ticket's focused E2E; typecheck (or package equivalent) for touched packages. Fix failures before shipping.
2. Update the ticket file: `Status: done` when acceptance fully holds; check every acceptance box that holds; append `## Comments` with audit verdict, Close vs Deepen, surfaces, E2E pointers, and any acknowledged **no-ui** siblings on the feature.
3. Commit following the repo's git commit protocol—**one commit per shipped ticket** (message names `feature/NN-slug` and why). Push the current branch (`git push -u origin HEAD` if upstream is missing). Never `--force` to `main`/`master`. Never skip hooks unless the user said so in this turn.

Then move to the next unblocked UI ticket on the plan.

For acknowledged **no-ui** skips: append a short `## Comments` note that `/deep-ui` skipped with user acknowledgment (no commit required unless the user asks).

**Done when:** every planned UI ticket is shipped, skips are acknowledged in ticket comments, commits are on the remote, and the working tree for shipped files is clean.

## Out of scope

- Implementing before the full-feature board is shown and the ship plan confirmed
- Silently skipping **no-ui** tickets
- Leaving any UI-bearing ticket without a `ui-ux-pro-max` + E2E task
- API-only deepening (`improve-codebase-architecture` / unit-integration `tdd`)—hand that lane to `/deep-api`
- Opening a PR (use `/pr` separately if wanted)
- Wayfinder decision tickets and `wontfix` — not working items
