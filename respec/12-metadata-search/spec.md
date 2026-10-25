Status: ready-for-agent

# 12 — Entity metadata, indexing and search (PLAT-META)

## Problem Statement

Users need governed, auditable metadata (tags, labels, typed fields) on every entity and fast, authorisation-scoped search across the platform.

## Solution

A generic entity-metadata model in PostgreSQL with inheritance, plus a dedicated search engine as a derived index (new ADR extending ADR 0004). Search applies AuthZ scope before paging.

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
- Search engine is OpenSearch or Meilisearch (choice during implementation, with a new ADR); AuthZ scope is applied before paging.
- Schemas are namespace-scoped from the start, with an instance-wide tier.
- File metadata unpinned by default; pin on approve/release.
- `sensitive` redacts everywhere; encryption only if later required.
- User and group metadata visibility: admins and self (proposal retained).
- Masked export: audit detail records filters, count and `masked`.
- Tag inheritance: latest statement closest to the entity wins.
- Multi-instance index consistency through generations.

## Testing Decisions

- HTTP tests per entity type for scope-before-paging, inheritance, provenance, redaction, reindex.
- Prior art: existing metadata API tests.

## Out of Scope

Encryption at rest of sensitive values, real-time cross-node replication beyond the shared engine.

## Further Notes

Fan-out on namespace edits needs async batching and an impact preview.
