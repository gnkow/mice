Status: needs-info
Blocked on: deployment target (Docker host vs Kubernetes) and the overlay-on-shared-filesystem spike (see 08).

# Cross-cutting decisions for the Mice platform respec

## Problem Statement

The sixteen plans were written against a JSON/JSONL/SQLite world and a single-instance assumption. ADR 0004 and 0005 replaced that with PostgreSQL, immudb and Novu, and the platform must now scale beyond one BFF instance. Operators, scientists and auditors need one consistent behaviour across epics, not sixteen plans that disagree.

## Solution

Treat the plans as intent only. Each epic gets a fresh spec (01-16) written as if unbuilt, and this spec holds the decisions that apply to all of them. ADRs 0001, 0002, 0004 and 0005 are truth; every JSON store, JSONL log, SQLite and `AUTH_DATA_DIR` reference in the plans is void.

## User Stories

1. As an operator, I want every epic to follow the same persistence model, so that I run one set of databases.
2. As an operator, I want to run more than one BFF instance, so that a single process is not a point of failure.
3. As an auditor, I want every mutation to be recorded before it takes effect, so that no change exists without a record.
4. As an auditor, I want an orphaned intent resolved to an outcome, so that I never see a mutation of unknown result.
5. As a scientist, I want identical behaviour from web, CLI and API, so that I can pick the tool that suits me.
6. As a compliance lead, I want `GXP_STRICT` to behave the same on every mutating surface, so that I can describe it once in validation documents.
7. As a developer, I want one test seam and real containers, so that tests reflect production.
8. As an instance admin, I want one place to revoke an identity everywhere, so that offboarding is complete.
9. As a repository owner, I want to rename a repository without losing its history in Mice, so that renames are safe.
10. As a security reviewer, I want egress and SSRF controls defined centrally, so that no epic invents its own.

## Implementation Decisions

- **Persistence:** PostgreSQL for relational state, immudb for audit, Novu (MongoDB, Redis) for notifications, a dedicated search engine for metadata search as a derived index rebuildable from PostgreSQL. A new ADR extends ADR 0004 to cover the search engine. No file or in-memory state for database-shaped data.
- **Multi-instance:** N BFF instances are a requirement. Any "single BFF" or `dataDirLock` assumption must be replaced by database-level coordination (leases, generation checks, advisory locks). Bulk tree state (workspace trees, job logs, checkouts) is placed on a shared RWX filesystem. Whether overlay mounts work on it is unresolved (see 08).
- **`GXP_STRICT`:** every mutation fails closed with 503 when its Intent event cannot be appended. No class is exempt. Lineage writes are also fail-closed under strict.
- **Intent/outcome reconciliation:** an Intent with no Outcome is resolved by a reconciler that re-queries oxen to infer the result and then appends an Outcome event.
- **Dataset version capture:** for every mutation class the BFF reads the dataset head before and after proxying (with a lock) and records `{base, head}` on the audit event.
- **Repository identity:** Mice gets a stable repository id independent of the `namespace/repo` name. AuthZ, favorites, metadata, lineage and audit references use it. Renames are copy+delete on oxen at the BFF, keep the id, and are audited.
- **Offboarding:** manual admin revoke by `iss`+`sub` is the supported route and is documented. No SCIM, no directory sync in this spec.
- **Retention:** records are kept until deleted. No default expiry for logs, outputs, lineage or audit.
- **Notifications:** every catalog category is on by default.
- **Authorization naming:** "Stage" is the user-facing term for an Oxen workspace; authz actions migrate to a `stage` resource with aliases and custom-role migration.
- **SSRF:** outbound fetches for imports run in a BFF-controlled, egress-restricted fetcher, never in oxen-server.
- **Digest:** SHA-256 is authoritative integrity evidence; oxen's XXH3-128 stays the oxen identifier.
- **Identity provider:** an external IdP is required in production; Keycloak is development-only.
- **Runners:** Docker and Kubernetes runners sit behind one runner interface.

## Testing Decisions

- A good test drives external behaviour only: HTTP requests in, responses and persisted effects out.
- Single seam: the BFF HTTP boundary, black-box, against the real containers (PostgreSQL, immudb, Novu, search engine). CLI and web get end-to-end tests only for behaviour that exists in those surfaces.
- Prior art: existing BFF API tests that already run on containers (ADR 0004) and the existing Playwright suite.
- Tests use unique ids and delete only their own rows; audit entries are filtered by unique ids.
- Multi-instance behaviour is tested by running at least two BFF instances against the same databases and filesystem.

## Out of Scope

- Backup and restore tooling (deferred until the deployment target is chosen).
- SCIM and automated deprovisioning.
- Retention policies and automatic purging.
- Binary distribution of the CLI.

## Further Notes

Unresolved: deployment target; overlay on shared filesystem; reviewer escalation target. Sections of plans on these topics stay open in the relevant specs.
