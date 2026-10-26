Status: ready-for-agent

# 12 — Entity metadata, indexing and search (PLAT-META)

## Problem Statement

Users need governed, auditable metadata (tags, labels, typed fields) on every entity and fast, authorisation-scoped search across the platform.

## Solution

A generic entity-metadata model in PostgreSQL with inheritance, plus a derived search index that starts as PostgreSQL full-text search; a dedicated engine is added only after a measured failure (ADR). Search applies AuthZ scope before paging.

## User Stories

1. As a user, I want to tag a repository, directory or file, so that I can organise data.
2. As a user, I want metadata to inherit down namespace → repository → directory → file, so that I set it once.
3. As a user, I want the closest statement to win (add or remove), so that overrides are predictable.
4. As a user, I want to see provenance of inherited values, so that surprises are explainable.
5. As a namespace owner, I want namespace-scoped field schemas, so that teams define their own fields.
6. As an instance admin, I want instance-wide schemas as well.
7. As a user, I want full-text and facet search, so that I find data quickly.
8. As a user, I want search to only return what I may see, including counts and facets, so that nothing leaks.
9. As a user, I want file metadata attached to the path by default and pinned to a version on approve/release, so that released data is stable.
10. As an admin, I want sensitive fields redacted everywhere by default, so that secrets are protected.
11. As an auditor, I want all metadata mutations audited with diffs.
12. As an admin, I want a reindex that builds a new generation and swaps atomically, so that search stays available.
13. As an admin, I want a breaking field-schema change to grandfather existing records with a `needs_migration` flag.
14. As a user, I want to export search results as CSV, with masking.
15. As a user, I want metadata history, so that I see who changed what.

## Implementation Decisions

- Own records and history in PostgreSQL are authoritative; the search engine is derived and rebuildable online.
- Search starts on PostgreSQL full-text; OpenSearch or Meilisearch only if the prototype misses the relevance set or load target (new ADR). AuthZ scope is applied before paging.
- Schemas are namespace-scoped from the start, with an instance-wide tier.
- File metadata unpinned by default; pin on approve/release.
- `sensitive` values are never indexed and never written to audit; masked at read; encryption only if later required.
- Index keys use stable repository ids; physical oxen names are static.
- User and group metadata is removed from the first release.
- Export is asynchronous with reason, filter snapshot, manifest digest, cap and expiry; audit detail records filters, count and `masked`.
- Index updates flow through the Postgres outbox with revision-guarded idempotent upserts (access changes: see Conflicts and open risks).
- Tag inheritance: latest statement closest to the entity wins.
- Multi-instance index consistency through generations.

## Testing Decisions

- HTTP tests per entity type for scope-before-paging, inheritance, provenance, redaction, reindex.
- Prior art: existing metadata API tests.

## Out of Scope

Encryption at rest of sensitive values, real-time cross-node replication beyond the shared engine.

## Further Notes

Fan-out on namespace edits needs async batching and an impact preview.

Open grilling questions: see questions.md in this folder.

## Decisions from grilling

Search and authorisation
- Allowed-set filter by stable repo id plus namespace shortcut; hits rechecked authoritatively; benchmark at 40k repos (Q1).
- Facets computed engine-side under the scope filter with a bucket cap; hidden-tag conformance test (Q3).
- Filter, sort and facet on sensitive fields blocked without view right; attempts audited (Q14).
- Access changes update the index synchronously; failure mode must be fail closed with recheck (Q2).
- Prototype Postgres full-text first; engine only on failure, with ADR (Q26).
- 50-query relevance set; identifier fields as keywords (Q23).
- Point-in-time paging with search-after, hard cap, 1M-document load test (Q24).
- Watermark-wait parameter for read-your-writes; two-instance swap test (Q28).

Index lifecycle
- Outbox, revision-guarded idempotent upserts, drift detector (Q4).
- Reindex: snapshot plus outbox replay, DB lease, pointer swap, count verification (Q5).
- Sparse index with non-exhaustive banner; audited async effective-metadata report (Q6).
- Rate-limited background indexer on default branches with visible state (Q25).
- Defer Session and Stage metadata; Jobs indexed sparsely (Q27).

Inheritance, fan-out and revisions
- Namespace edit: advisory impact preview, actual count recorded, "updating" state, query-time resolution namespace→repo (Q7).
- Effective-metadata snapshot at every merge, immutable, with signer identity (Q8).
- Metadata revision recorded in Pin and Job lineage; committed snapshot opt-in (Q9).
- Head capture only for pin/snapshot; one per bulk operation; Intent event kept; documented exception (Q10).
- Bulk: one Intent and Outcome per request with per-ref results, cap, all-or-nothing per repo (Q11).
- Per-entity revisions plus chain token for locked/regulated fields (Q21).

Sensitive data, schemas, identity
- Sensitive never in audit: keyed hash plus changed marker (Q12).
- Never indexed; masked at read; all-surface contract test (Q13).
- Reserved instance keys; other keys auto-qualified (Q15).
- Breaking schema change: dry-run, second approver, migration queue with deadline (Q16).
- Stable repo-id prefix; names resolved at display; aliases (Q17).
- User/group metadata removed from first release (Q19).
- Tombstones kept; values stripped after owner period for non-regulated data; documented exception (Q20).
- Export: async, reason, filter snapshot, manifest digest, cap, expiry (Q22).

## Conflicts and open risks

- Q2: synchronous index update on access change contrasts with the outbox (Q4) and the one-owner-per-fact rule; failure mode must be defined (fail closed, recheck) and a sync write into a derived index risks Main-database/index dual-write inconsistency.
- Q10: head capture and skipped per-item Intent is a documented exception to Intent-before-mutation; needs ADR-level sign-off from 03/04.
- Q20: stripping values after the owner period conflicts with no-hard-delete unless tombstones and audit are kept; documented exception.
- Q6: sparse index means search is non-exhaustive by design; users must see the banner.
- Q26/Q24: engine choice is conditional on measured results; 1M target unproven.
- Q19 removes user/group metadata; any module referencing it (e.g. admin views) must not assume it.
- Q17/Q18 depend on stable repo ids and static oxen names (inherited global decisions); 16 Q24 wipes the pilot so no migration is needed.
