Status: ready-for-agent

# 03 — Audit (PLAT-AUDIT)

## Problem Statement

Regulated users need proof of who changed what, when, and with what result, that cannot be silently altered, and a mutation must never exist without a record.

## Solution

An Audit module over immudb with append, read range and verify. Every mutation writes an Intent event before it takes effect and an Outcome event after, linked by `intent_id`. Append failure refuses the mutation with 503. A reconciler resolves orphaned intents.

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
- Intent failure returns 503 for every mutation (no exceptions).
- The reconciler re-queries oxen to infer a result, then appends an Outcome event.
- Before/after dataset head is read, with a lock, around every proxied mutation and stored as `{base, head}`.
- Reason and change-control id are first-class event fields; ownership split with GxP is that this spec stores them and 04 decides when they are required.
- Events reference repositories by stable id plus the name at event time.
- Export reads are not separately audited.
- Multi-instance safe: no instance-local queues.

## Testing Decisions

- HTTP-level tests: perform a mutation, read the Intent and Outcome through the read API, kill the audit store and expect 503.
- Reconciliation tested by simulating a crash between proxying and the Outcome append.
- Prior art: existing audit API tests on the immudb container.

## Out of Scope

Retention and purge, WORM storage beyond immudb, backup of immudb.

## Further Notes

The extra oxen read adds latency to every mutation; measure it.
