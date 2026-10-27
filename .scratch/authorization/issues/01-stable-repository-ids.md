# 01: Stable Repository IDs Infrastructure

**What to build:** Create a repositories table with UUID primary keys so that authorization, audit, favorites, and all other systems can reference repositories by stable ID rather than by namespace/name pairs. When a user creates a repository and grants collaborator access, the system uses the repository ID throughout (database, API responses, audit logs). Repository rename does not break existing grants or references.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Add `repositories` table with columns: `id` (UUID, PK), `namespace_id` (FK to namespaces, will be added in ticket 02), `name` (text), `created_at`, `updated_at`
- [ ] Add unique constraint on `(namespace_id, name)` once namespace IDs exist
- [ ] Update repository creation to mint UUID and insert into repositories table
- [ ] Authorization collaborator checks resolve repository ID from path on each request
- [ ] API responses include `repository_id` field
- [ ] Tests verify repository creation returns stable ID
- [ ] Tests verify same repository has same ID across requests
- [ ] Tests verify authorization works by ID (not just name)
