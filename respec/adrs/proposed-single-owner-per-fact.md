---
status: proposed
---

# Every fact has exactly one owning store; derived stores are rebuilt through a PostgreSQL outbox

## Context

The system spans six stores: PostgreSQL, immudb, oxen, the filesystem, the notification inbox projection and the search index. Without a rule, two stores answer the same question and drift (00 Q26, 03 Q1/Q9, 12 Q4/Q5).

## Decision

| Fact | Owner |
|---|---|
| Permissions, state, relational data | PostgreSQL |
| What happened (Intent/Outcome) | immudb |
| Scientific data and history | oxen |
| Workspace trees, logs, checkout files | filesystem |
| Messages (inbox) | PostgreSQL projection (Novu delivers only) |
| Search results | derived index, never authoritative |

- Changes that must reach another store are written to a PostgreSQL outbox in the same transaction as the state change. A relay delivers them to immudb, the search index and notifications with idempotent, revision-guarded writes.
- Intent precedes the mutation; if the database commit fails, a compensating Outcome is written.
- Every derived fact has a repair job and a drift detector that rebuilds it from the owner.
- One reconciler leader (advisory lock) resolves Intents without an Outcome; Outcomes are idempotent by intent id.

## Consequences

- No distributed transactions; consistency is eventual and measurable.
- Outbox lag needs a latency SLO and monitoring.
- Each new feature must name its owning store before it is built.

## Alternatives rejected

- Dual writes from the BFF: partial failure leaves stores disagreeing.
- immudb as the source for state: an append-only log is not queryable state.
- Treat Novu or the search engine as authoritative: they are replaceable.
