Status: needs-info
Blocked on: the overlay-on-shared-filesystem spike (see 08), legal sign-off on the no-erasure stance (Q8).

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
6. As a compliance lead, I want GxP strict behaviour, always on, to be identical on every mutating surface, so that I can describe it once in validation documents.
7. As a developer, I want one test seam and real containers, so that tests reflect production.
8. As an instance admin, I want one place to revoke an identity everywhere, so that offboarding is complete.
9. As a repository owner, I want to rename a repository without losing its history in Mice, so that renames are safe.
10. As a security reviewer, I want egress and SSRF controls defined centrally, so that no epic invents its own.

## Implementation Decisions

- **Persistence:** PostgreSQL for relational state, immudb for audit, Novu (MongoDB, Redis) for notifications, a dedicated search engine for metadata search as a derived index rebuildable from PostgreSQL. A new ADR extends ADR 0004 to cover the search engine. No file or in-memory state for database-shaped data.
- **Multi-instance:** N BFF instances are a requirement. Any "single BFF" or `dataDirLock` assumption must be replaced by database-level coordination (leases, generation checks, advisory locks). Bulk tree state (workspace trees, job logs, checkouts) is placed on a shared RWX filesystem. Whether overlay mounts work on it is unresolved (see 08).
- **GxP strict:** always on; it is not a switch. Every mutation fails closed with 503 when its Intent event cannot be appended. No class is exempt and there is no protective-action exemption. Lineage writes are also fail-closed. Lease renewals are NOT exempt: every renewal has its own Intent/Outcome (auth round 6 S1).
- **Intent/outcome reconciliation:** an Intent with no Outcome is resolved by a reconciler that re-queries oxen and infers the result only when verifiable by content digest; otherwise the Outcome is "unknown", labelled as such in exports.
- **Dataset version capture:** for every mutation class the BFF records `{base, head}` on the audit event, using the commit id oxen returns where available, an optimistic base-verify elsewhere, and a lock only where oxen is not atomic.
- **Repository identity:** Mice gets a stable repository id independent of the `namespace/repo` name. AuthZ, favorites, metadata, lineage and audit references use it. Physical oxen repository names are static (keyed by the stable id); a rename changes only the BFF's persistence layer, keeps the id and every commit id, and is audited.
- **Offboarding:** admin revoke by `iss`+`sub` stays available, and back-channel logout (Sessions only) and directory-based revocation are supported. No SCIM provisioning.
- **Retention:** records are kept until deleted. No default expiry for logs, outputs, lineage or audit.
- **Notifications:** defaults follow criticality: action-required categories on (including email), informational in-app only or off.
- **Authorization naming:** "Stage" is the user-facing term for an Oxen workspace; authz actions use a `stage` resource directly; this is a new project, so there are no legacy names, aliases or migration.
- **SSRF:** URL import is disabled until allowlist, redirect re-validation, caps and provenance controls exist; any future fetch runs in a BFF-controlled, egress-restricted fetcher, never in oxen-server.
- **Digest:** SHA-256 is authoritative integrity evidence; oxen's XXH3-128 stays the oxen identifier.
- **Identity provider:** an external IdP is required in production; Keycloak is development-only.
- **Runners:** Kubernetes is the production target; Compose is development-only. Runners sit behind one interface in a separate runner service that holds the Docker socket or cluster credentials; the BFF never mounts them. Jobs use BFF-internal tokens; service principals do not exist.

## Testing Decisions

- A good test drives external behaviour only: HTTP requests in, responses and persisted effects out.
- Single seam: the BFF HTTP boundary, black-box, against the real containers (PostgreSQL, immudb, Novu, search engine). CLI and web get end-to-end tests only for behaviour that exists in those surfaces.
- Prior art: existing BFF API tests that already run on containers (ADR 0004) and the existing Playwright suite.
- Tests use unique ids and delete only their own rows; audit entries are filtered by unique ids.
- Multi-instance behaviour is tested by running at least two BFF instances against the same databases and filesystem.

## Out of Scope

- SCIM provisioning.
- Retention policies and automatic purging.
- Binary distribution of the CLI.

## Further Notes

Unresolved: overlay on shared filesystem; reviewer escalation target (Q24); legal sign-off on retention. The deployment target is decided (Kubernetes). Backup and restore is a hard start gate, not deferred.

Open grilling questions: see questions.md in this folder.

## Decisions from grilling

Concurrency and coordination
- Fencing tokens are recorded in the tree and checked by every writer; Postgres is the source of truth (Q1).
- Each module keeps an in-process-state inventory as a release gate, plus a randomized two-instance test on every mutation route (Q2).
- Dataset version capture uses the oxen commit id, optimistic base-verify, and locks only where oxen is not atomic (Q6).
- One owner per fact: Postgres owns permissions and state, immudb what happened, oxen data, the filesystem files, the Postgres projection messages, search is derived. Derived stores are rebuilt from Postgres via one outbox, with a repair job per fact (Q26).

Audit and GxP
- Absolute fail-closed on Intent failure, risk documented, no protective-action exemption (Q3).
- All reads are audited (Q4); database time orders events, with record time and effect time stored separately (Q17).
- An Outcome is inferred only when verifiable by content digest, else "unknown", visible in exports (Q5).
- Every event carries a responsible human owner (Q19).
- Authored-by is separate from signed-by; no self-signing in GxP namespaces; meaning chosen and step-up applied at signing (Q9).
- Revocation lifts "approved" on dependent Pins, warns downstream lineage and notifies owners (Q10).
- Erasure is impossible; documented as the legal-retention stance (Q8).
- id_token signature is always verified; ADR 0001 is amended; strict values on by default (Q18).

Repositories and data
- Rename freezes the repository and verifies digest and commit chain (Q7); superseded by static physical names, rename only in the BFF (see Conflicts).
- Pin oxen by image digest, with contract tests per candidate version and controlled upgrade (Q27).
- SHA-256 is computed in the BFF upload stream, stored beside the Pin and verified on download and Job input; background verification covers other ingress (Q14).
- URL import is disabled until controls exist (Q15).
- Namespace schemas extend a shared instance-level base schema (Q21).
- Search hits are filtered through authorization, counts follow filtering, and Postgres full-text search is reconsidered before a separate engine (Q20).

Identity, naming and surfaces
- Back-channel logout and directory-based revocation are kept; the spec is fixed (Q11).
- Stage naming is used directly, with no aliases or migration (Q16).
- Notification defaults follow criticality (Q12).
- The CLI is pinned exactly and served from the BFF itself (Q25).
- No automatic retries (Q23); role-only reviewer gate, escalation unresolved (Q24).

Testing and parity
- Test-only fault-injection hooks sit at the HTTP boundary, with a crash-point list in the spec (Q13).
- A one-off parity checklist from code and tests is marked keep/change/drop by the owner (Q28).

## Conflicts and open risks

- Q8 (erasure impossible): conflicts with its own option analysis; legal sign-off needed. Blocker for Status.
- Q3 (absolute fail-closed) holds with no exception: 08 Q18 aggregation was dropped (auth round 6 S1). RESOLVED. Consequence: immudb outage stops Workspace work at lease expiry; size lease TTL and renewal rate accordingly.
- Q22 (recording mandatory in strict) is OVERRIDDEN by the global decision and 10 Q4: desktop sessions are never recorded. 04 Q22 still inherits Q22 and must be corrected; compensating controls are one read-write session per Workspace and off-box auditd.
- Q7 (copy-based rename with freeze) is superseded by 05 Q25: static physical names, rename only in the BFF. 05 Q3-Q6 are mostly moot.
- Q24: reviewer escalation target remains unresolved (04 Q18 also awaits owner confirmation).
- Q23: no automatic retries, yet 09 Q9 retries the finalize Intent and 03 Q21 retries the Outcome inline; the spec must state these are bounded internal retries, not mutation retries.
- Q19 (service principals can never sign) is moot: service principals are removed (01 Q12, Q13); Jobs use BFF-internal tokens and automated commits are never signed (08 Q7).
- The overlay-on-shared-filesystem spike (08 Q1) is UNRESOLVED; Kubernetes is the production target (16 Q1) but Jobs on it are unsupported until the spike passes (09 Q11). Blocker for Status.
- Q15: URL import disabled; entry criteria for re-enabling are undefined (06 Q9).
- Q20: Postgres full-text search is the first attempt (16 Q25); a separate engine needs a new ADR.
- 16 Q2 and 04 Q16 make backup and restore a hard start gate; the former deferral is void.
- 16 Q21: DEFERRED supply-chain/SBOM gap must close before regulated use.
- 16 Q27: maintenance windows only; inferred outcomes remain possible after a crash.
- 04 Q10: whether research repositories need an exemption from always-on strict is open.
- Q26: derived stores repaired via Postgres outbox; 04 Q17 verification is report-only and never repairs or deletes.

## Update from authentication review
- GxP requirements beat GDPR on conflict; no identity data is erasable; no IPs stored (auth R2, round 5). Legal sign-off on the no-erasure stance remains open.
- IdP is single and unchanging; iss+sub is never reused (auth Q29, S8).
