---
status: accepted
supersedes: 0003
---

# Durable state lives in containerised production databases chosen per service

Mice has no data to preserve, and production-grade systems must run the same way locally, in CI and in production. SQLite and the memory adapter are removed; there are no JSON or in-memory persistence solutions for database-shaped state.

- **PostgreSQL** holds the main relational data (authorization, identity keys, jobs, sessions, lineage, favorites, announcements, credentials, metadata schema `meta`). Domain stores talk to it directly through Drizzle. There is no generic backend seam and no second adapter.
- **immudb** holds the audit trail behind a separate audit module (append, read range, verify). See ADR 0005.
- **Novu** (with MongoDB and Redis) owns notifications. The notification worker projects audit events into Novu through its API.
- Workspace trees, workspace state and lease files, checkout metadata and job logs stay on disk, with `dataDirLock` guarding that disk. They are file-tree state, not database state.
- Every store call is asynchronous. A database outage fails closed: `/readyz` is red and requests get 503.
- Tests use the same containers as development, in parallel, without new databases or schemas. Each test uses unique ids and deletes only its own PostgreSQL rows. Audit entries cannot be deleted, so tests filter by unique ids.
- Legacy importers, identity-key and meta migrations, and the v1-v5 SQLite migrations are deleted; Drizzle's SQL migrations start from one baseline.
- Backups and database maintenance code are removed for now; they return as database-container operations when needed.

## Considered options

- Keep SQLite in a container volume: no network protocol, so tests would not run on the same protocol as production.
- Audit in a separate PostgreSQL database with an INSERT-only role: simpler (one engine) but tamper evidence is only as strong as the role setup, not a database property.
- PostgreSQL for notifications: simpler and joinable, but not a dedicated system.

## Consequences

- Unit tests need the containers up; `make test-unit` is no longer stack-free.
- Tests that assert global counts or lists must filter by their own ids.
- The stack grows by PostgreSQL, immudb, MongoDB, Redis and Novu's own containers.
- ADR 0003's single-writer reasoning no longer constrains the design.
