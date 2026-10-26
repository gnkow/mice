Status: needs-info
Blocked on: nothing from lease renewals (strict, no exemption).

# 03 — Audit (PLAT-AUDIT)

## Problem Statement

Regulated users need proof of who changed what, when, and with what result, that cannot be silently altered, and a mutation must never exist without a record.

## Solution

An Audit module over immudb with append, read range and verify. Every mutation writes an Intent event before it takes effect and an Outcome event after, linked by `intent_id`. Append failure refuses the mutation with 503. Events reach immudb through a Postgres outbox and relay. A reconciler resolves orphaned intents.

## User Stories

1. As an auditor, I want to read audit events by time range, actor, action and resource, so that I can investigate.
2. As an auditor, I want to verify the trail with immudb proofs, so that tamper evidence is demonstrable.
3. As a compliance lead, I want every mutation refused when the audit store is down, so that no unrecorded change happens.
4. As an auditor, I want each Intent linked to its Outcome, so that I see whether a mutation completed.
5. As an auditor, I want orphaned intents resolved to a real outcome, so that crashes leave no ambiguity.
6. As an auditor, I want the dataset head before and after each mutation, so that I know which data version was affected.
7. As an auditor, I want reason and change-control id on the event, so that changes are justified.
8. As an auditor, I want to export events in a readable form, so that inspectors can review.
9. As an instance admin, I want audit read access gated by AuthZ, so that sensitive events stay protected.
10. As a security reviewer, I want secrets and tokens never in event detail, so that audit is not a leak.
11. As a developer, I want a documented event schema per action, so that producers are consistent.
12. As an operator, I want `/readyz` to reflect audit health, so that orchestration pulls unhealthy instances.
13. As an auditor, I want reads of audit itself recorded, so that access to the trail is accountable.

## Implementation Decisions

- immudb is the only audit store; there is no home-grown hash chain (ADR 0005).
- Intent failure returns 503 for every mutation (no exceptions, including lease renewals).
- The reconciler runs as one leader (PostgreSQL advisory lock), infers a result only when verifiable by content digest (else "unknown"), and appends an Outcome idempotent by intent id.
- The dataset content digest and oxen commit id are recorded before and after each proxied mutation as `{base, head}`; locks are used only where oxen is not atomic.
- Reason and change-control id are first-class event fields; ownership split with GxP is that this spec stores them and 04 decides when they are required.
- Events reference repositories by stable id plus the name at event time.
- Every export is audited (filters and row count); browsing reads are recorded as summary events.
- Multi-instance safe: no instance-local queues.

## Testing Decisions

- HTTP-level tests: perform a mutation, read the Intent and Outcome through the read API, kill the audit store and expect 503.
- Reconciliation tested by simulating a crash between proxying and the Outcome append.
- Prior art: existing audit API tests on the immudb container.

## Out of Scope

Retention and purge, WORM storage beyond immudb.

## Further Notes

The extra oxen read adds latency to every mutation; the budget is p95 overhead of 250 ms, tested.

Open grilling questions: see questions.md in this folder.

## Decisions from grilling

Write path and reconciliation
- A central audit-writer path uses the Postgres outbox with batching; single-writer contention is spiked against a latency SLO (Q1).
- The outbox row is written in the same transaction as the domain change and relayed to immudb; the Intent precedes the mutation; a compensating Outcome is written if the database commit fails (Q9).
- One reconciler leader via PostgreSQL advisory lock; the Outcome is idempotent by intent id (Q4).
- An Intent is orphaned after 2 minutes (configurable); the UI shows "result being confirmed"; a QA alert fires after 15 minutes (Q5).
- Outcome append uses bounded inline retry, then returns the real result with an "audit pending" header and the reconciler completes it (Q21).
- Event ids are deterministic and client-supplied; a conflict means already stored (Q22).
- Inherited: absolute fail-closed (Q2), digest-verifiable inference else unknown (Q3), oxen commit id or optimistic base-verify (Q6), database time ordering (Q18), successes to immudb and failures to the operational log (Q20), no service principals (Q24).

Evidence and integrity
- The dataset content digest plus oxen commit id are recorded before and after (Q7).
- The immudb root hash is published externally at intervals and verified on schedule (Q10).
- immudb is pinned; CI cross-checks against immudb tooling; the official auditor runs in production (Q11).
- Scheduled verify raises an alert and an integrity-incident event; GXP_STRICT flips to read-only on failure (Q12).
- A derived Postgres query index (not evidence) is monthly partitioned and verified (Q14).
- immudb follower replication plus scheduled snapshots are in scope now, exempt from the earlier backup deferral (Q17).
- Overhead budget: p95 mutation overhead at most 250 ms, tested; uploads check at start and publish (Q8).

Schema, export and access
- Each event carries a schema version with upcasters; action names are never renamed, aliases only (Q19).
- An allowlist schema per action plus a secret scanner that rejects token patterns (Q25).
- Every export is audited with filters and row count; browsing reads become summary events (Q15).
- The export bundle holds proofs, a signed manifest and human-readable CSV/PDF (Q16).
- A distinct Auditor role; no self-assignment without a second admin; QA alert; audit-of-audit by others (Q23).
- Legal-retention stance inherited (Q13).
- No parallel CI workers share immudb; the destructive suite is serial (Q26, interpretation).

## Conflicts and open risks

- Lease renewals: audited per renewal (08 Q18 revised); RESOLVED. Event volume must be capacity-planned.
- Q26: the answer was truncated; the interpretation (serial destructive suite, no parallel CI workers) needs CONFIRM.
- Q17 contradicts the former "backup of immudb out of scope"; the spec is corrected, and 04 Q16 and 16 Q2 make backup and restore a hard start gate.
- Q15 versus 02 Q9: browsing reads are summarized per page or session; sensitive reads and bypass mutations are individual events. Align the summary granularity.
- Q15 contradicts the earlier "export reads are not audited" line; fixed.
- Q12: the read-only flip on integrity failure is itself a mutation freeze; it interacts with 15 Q7 where break-glass is declined (incident-response RISK).
- Q21: the "audit pending" header lets a user see a result before its Outcome is stored; the reconciler must guarantee completion.
- Q5: a QA alert after 15 minutes depends on 16 Q4/Q5 availability targets; unresolved until set.
- Q1: single-writer contention is only spiked; a failed spike would force a redesign.
- Q10: external publication of the root hash needs a destination chosen by the owner; not decided.
- Q23 and 04 Q8: signature records live in immudb with a Postgres index only; keep the index non-authoritative.
- Q9: the compensating Outcome after a failed database commit is an exception to "Outcome follows the mutation" and must be documented in the event schema.
