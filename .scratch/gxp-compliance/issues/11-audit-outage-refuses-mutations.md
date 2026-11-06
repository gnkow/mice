# 11: Audit outage refuses mutations

**What to build:** When audit is unavailable every mutation is refused and reads continue. There is no outbox and no held output. Users see "audit unavailable, nothing was saved" and the client keeps local work. A Job finishing during an outage does not persist its result.

**Blocked by:** 10

**Status:** ready-for-agent

- [ ] Audit outage: mutations return "audit unavailable, nothing was saved"; reads work
- [ ] No outbox and no held-output path remain
- [ ] The "finalizing" state and audit-pending header handling are removed
- [ ] A Job finishing during an outage does not persist its result and reports failure
