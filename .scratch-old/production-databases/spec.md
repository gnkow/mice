Status: ready-for-agent

## Problem Statement

Mice stores its durable state in SQLite inside the auth process, with an in-memory adapter for tests, legacy JSON importers and migrations for data that never existed, and SQLite-specific backup and maintenance code. Tests therefore exercise a different implementation than production, a database outage cannot be expressed as an independent system, and audit tamper evidence rests on our own hash chain and triggers an owner can drop. The project is blank, so none of the legacy handling protects anything.

## Solution

Every database-shaped store runs as a production-grade system in a container, reached over its network protocol identically in local development, CI and production. PostgreSQL holds the main data, immudb holds the audit trail behind a separate audit module, and Novu owns notifications. Workspace files stay on disk. Tests use the same containers. All legacy migration code is deleted and the schema starts from one baseline. See ADR 0004 and ADR 0005.

## User Stories

1. As an operator, I want the main data in a containerised PostgreSQL, so that production runs a standard, inspectable database.
2. As an operator, I want one compose stack that starts PostgreSQL, immudb, MongoDB, Redis and Novu, so that local and production topology match.
3. As an operator, I want database credentials supplied as secrets, so that they are not in environment files.
4. As an operator, I want `/readyz` to go red and requests to get 503 when PostgreSQL, immudb or Novu is down, so that failures are visible and safe.
5. As an operator, I want the BFF to refuse to start when the schema is missing or at an unexpected version, so that a half-initialised database never serves.
6. As an operator, I want the BFF to apply its baseline schema on first boot, so that a blank environment needs no manual setup.
7. As a developer, I want unit tests to run against the same databases as the dev stack, so that tests exercise the real protocol and constraints.
8. As a developer, I want tests to use unique ids and delete only their own rows, so that parallel runs and the running dev stack do not interfere.
9. As a developer, I want `make test-unit` to tell me clearly when the containers are not up, so that a failure is not mistaken for a bug.
10. As a developer, I want no memory or file adapter in the codebase, so that there is one implementation to reason about.
11. As a developer, I want legacy importers, identity-key migration, meta migration and v1-v5 migrations deleted, so that boot has no dead paths.
12. As a developer, I want legacy field readers (grandfathered token expiry, legacy favorite types, legacy job fields) removed, so that domain types describe only current data.
13. As a developer, I want every store call to be asynchronous, so that a networked database can be used.
14. As a developer, I want multi-step changes to run in a real transaction, so that undo logic for partial failures is unnecessary.
15. As a developer, I want typed tables for authorization namespaces, members, collaborators and custom roles, so that the database enforces invariants.
16. As a developer, I want job aliases, favorites, announcements, access requests, sessions, lineage and credentials in typed tables, so that no JSON documents remain for relational data.
17. As a developer, I want free-form payloads (such as audit detail) stored in JSON columns only where they are genuinely free-form, so that typing is not forced where it does not fit.
18. As an auditor, I want every mutation to have an Intent event stored before it proceeds, so that unrecorded changes are impossible.
19. As an auditor, I want an Outcome event linked by `intent_id`, so that unfinished mutations are detectable.
20. As an auditor, I want an Intent event that cannot be stored to refuse the mutation with 503, so that audit gaps fail closed.
21. As an auditor, I want an audit `verify` operation backed by immudb's verified reads and proofs, so that tampering is detectable.
22. As an auditor, I want to read a range of audit events, so that I can export and review them.
23. As a compliance owner, I want the removal of our hash chain, signed checkpoints and signing key documented, so that validation documents are updated.
24. As a user, I want my in-app notifications served by Novu, so that read and unread state is managed by a dedicated system.
25. As a user, I want notifications generated from audit events, so that they match what actually happened.
26. As an operator, I want the notification worker to resume from its last audit position after a restart, so that no event is missed or duplicated.
27. As a developer, I want metadata records and their revision history in PostgreSQL with a unique revision per record, so that concurrent edits are detected.
28. As an operator, I want the data directory lock kept only for the workspace disk, so that two BFFs cannot share workspace files.
29. As an operator, I want workspace trees, state, leases and checkout metadata to stay on disk, so that file-tree state moves with its directory.
30. As a developer, I want Drizzle migrations as plain SQL, so that the schema is reviewable and versioned from the baseline.
31. As a developer, I want the backup and restore targets removed, so that nothing misleading remains.
32. As a reviewer, I want docs (README, operations plan, glossary, `.env.example`, compose) updated, so that they match the system.

## Implementation Decisions

- Main data: PostgreSQL through Drizzle, one connection pool, called directly by the domain stores. No generic backend interface and no second adapter. Transactions are real database transactions; the "never await inside a transaction" rule is replaced by a transaction scope callback.
- Audit module: its own interface with append, read range and verify, implemented on immudb. Separate from the main data modules. The Intent/Outcome contract and fail-closed 503 behaviour are preserved; the hash chain, signed checkpoints and signing key are removed along with their verification endpoint and replaced by `verify` using immudb proofs.
- Notifications: Novu with MongoDB and Redis. The worker projects audit events into Novu through its API and records its last audit position in PostgreSQL. The web inbox reads through the BFF, which talks to Novu.
- Metadata: PostgreSQL schema `meta` with records and an append-only revisions table, unique per record and revision.
- Schema: one baseline Drizzle migration; all legacy migration steps and importers are deleted, including legacy field handling in the credential, favorites, jobs, audit and identity modules.
- Concurrency: the BFF stays a single instance. The data directory lock remains for the workspace disk only.
- Disk state: workspace state, base, leases, change cache, checkout metadata and job logs stay on disk with their existing disk document module.
- Readiness: reports connectivity and schema version for PostgreSQL, immudb and Novu.
- Operations: backup, restore, maintenance schedules, their environment variables and Makefile targets are deleted.
- Compose: adds PostgreSQL, immudb, MongoDB, Redis and Novu services with healthchecks and volumes; the auth service depends on healthy databases; credentials via secrets.
- Async conversion is one sweep across stores and call sites, ticketed per store group.

## Testing Decisions

- Good tests assert external behaviour through the highest available seam: the BFF's HTTP app (existing `app.test.ts` style) and store interfaces, never SQL strings or internals.
- All tests run against the live dev containers. Each test file gets a private, throwaway schema inside the live PostgreSQL server (`db/testSchema.ts`: created, migrated with the real baseline, dropped afterwards), so parallel files and dev data never collide and global singletons (instance admins, enforce) are testable. This replaces the earlier unique-ids-and-delete-own-rows plan, which could not isolate global state. Assertions on shared systems (immudb) filter by unique ids. Audit events cannot be deleted, so audit assertions filter by unique ids.
- No adapter matrix and no memory adapter. Failure injection (database down, audit write rejected) uses an unreachable connection configuration or a wrapper at the audit module's interface, the single seam.
- Prior art: `app.test.ts`, `authzRepository.test.ts`, `auditIntent.test.ts`, `stores.test.ts`, `notifications.test.ts`.
- Test helpers: a replacement for `isolatedAuth` that connects to the containers and supplies unique ids and cleanup.
- Do not run the full e2e suite; run targeted specs only.

## Out of Scope

- Workspace file trees, state files, leases and job logs moving into a database.
- The oxen-server store and Keycloak's own database.
- Backups, point-in-time recovery and database maintenance.
- Running more than one BFF instance.
- Revisiting ADR 0001 and ADR 0002.

## Further Notes

- Tests that assert global counts or lists will need rewriting to filter by their own ids.
- The dev audit database accumulates test events permanently.
- GxP validation documents referring to the hash chain and signed checkpoints must be updated separately.
- `make test-unit` now requires the stack's databases to be up.
