---
status: proposed
---

# Schema migrations are expand-then-contract and run pre-deploy under an advisory lock

## Context

Migrations applied at boot from one baseline (ADR 0004). With N instances starting together, two can run the same migration, and during a rolling upgrade the old version runs against the new schema (16 Q9).

## Decision

- Migrations run as a pre-deploy step (a single job), not at instance boot, and take a PostgreSQL advisory lock so only one runner applies them.
- Every schema change is expand-then-contract across releases: first add (nullable columns, new tables, dual writes, backfill), then switch reads, then in a later release remove the old shape.
- Each release must work against both the previous and the next schema (n-1/n compatibility); a migration that breaks the running version is rejected in review.
- Instances refuse to serve if the schema is older than they need, and `/readyz` reports it.
- The supported BFF/web/CLI version pairings are stated per release; the CLI is served by the BFF itself (00 Q25).

## Consequences

- Rolling upgrades work with no downtime.
- Contract steps take an extra release; destructive changes are delayed.
- Rollback is application-only; data steps are forward-only, so each migration needs a tested restore plan.
- CI needs a test that runs the old app against the new schema.

## Alternatives rejected

- Migrate at boot with a lock: fine for one instance, but still breaks old versions mid-rollout.
- Maintenance-window big-bang migrations: downtime on a regulated system.
- Down-migrations: rarely tested and unsafe with data.
