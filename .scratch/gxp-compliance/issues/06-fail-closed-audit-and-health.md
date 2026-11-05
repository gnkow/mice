# 06: Fail-closed audit, reconciliation and health

**What to build:** Every mutation writes an audit intent, then takes effect, then writes an outcome; failed outcomes are audited too. When audit is unavailable every mutation is refused and reads continue. There is no outbox and no held output. A reconciler flags intents without an outcome (it writes its own audit record and never repairs). An audit health probe and operator alert are required; a single immudb instance is unsupported in production.

**Spec:** `.specs/04-gxp-compliance.md`, `.specs/03-audit.md`, `.specs/09-jobs.md`, `.specs/16-operations.md` (alignment with 04)

**Blocked by:** None

**Status:** ready-for-agent

## Acceptance

- [ ] Intent is written before the effect, outcome after, including failed outcomes
- [ ] Audit outage: mutations return "audit unavailable, nothing was saved"; reads work
- [ ] The "finalizing" state, audit-pending header and held-output handling are removed
- [ ] A Job finishing during an outage does not persist its result and reports failure
- [ ] The reconciler flags orphan intents with an audit record, never repairs
- [ ] Health probe, alert and a production check against single-instance immudb
