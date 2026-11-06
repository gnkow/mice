# 12: Orphan-intent reconciler

**What to build:** A reconciliation job flags intents without an outcome. It writes its own audit record and never repairs the underlying mutation.

**Blocked by:** 10

**Status:** ready-for-agent

- [ ] Reconciler finds intents with no outcome
- [ ] Each finding writes its own audit record
- [ ] Reconciler never repairs or replays the original mutation
- [ ] Operator can see flagged orphans
