# 01: Stable Repository IDs Infrastructure

**What to build:** Create a repositories table with UUID primary keys so that authorization, audit, favorites, and all other systems can reference repositories by stable ID rather than by namespace/name pairs. When a user creates a repository and grants collaborator access, the system uses the repository ID throughout (database, API responses, audit logs). Repository rename does not break existing grants or references.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Add `repositories` table with columns: `id` (UUID, PK), `namespace_id` (FK to namespaces, will be added in ticket 02), `name` (text), `created_at`, `updated_at`
- [x] Add unique constraint on `(namespace_id, name)` once namespace IDs exist
- [x] Update repository creation to mint UUID and insert into repositories table
- [x] Authorization collaborator checks resolve repository ID from path on each request
- [x] API responses include `repository_id` field
- [x] Tests verify repository creation returns stable ID
- [x] Tests verify same repository has same ID across requests
- [x] Tests verify authorization works by ID (not just name)

## Comments

**Deep-api Close (2026-11-13):** Audit found schema/mint/authz-by-id holding but proxied create responses omitted `repository_id`. Closed at seams `proxyEffects.seedRepoCreate` / `attachRepositoryId` + `proxy.ts` repo.create path. Unit: `proxyEffects.test.ts`. Integration: `proxyRepoCreateId.test.ts`.


**Deep-ui (2026-11-13):** Skipped as **no-ui** with user acknowledgment on implement. Acceptance has no UI surface to deepen under `/deep-ui`.
