# 12: Orphan-intent reconciler

**What to build:** A reconciliation job flags intents without an outcome. It writes its own audit record and never repairs the underlying mutation.

**Blocked by:** 10

**Status:** wontfix

- [ ] Reconciler finds intents with no outcome
- [ ] Each finding writes its own audit record
- [ ] Reconciler never repairs or replays the original mutation
- [ ] Operator can see flagged orphans

## Comments

2026-11-06 — Declined. An Intent with no Outcome already is the flag; ticket 10 surfaces orphans via the audit. A reconciler that re-records the same absence adds no control.
