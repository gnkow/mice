# 03: Migrate Authorization Stores to Entity IDs

**What to build:** All authorization-related tables (collaborators, members, custom roles, favorites, workspaces, jobs) reference repositories and namespaces by stable UUID, not by name strings. Audit events store both the stable ID and a human-readable name snapshot at the time of the event. Tombstone tables prevent reuse of deleted/renamed entity names for a period. After this ticket, renaming a repository or namespace does not orphan any grants, favorites, or audit trail.

**Blocked by:** 01 (Stable Repository IDs Infrastructure), 02 (Stable Namespace IDs Infrastructure)

**Status:** done

- [x] Migrate `repoCollaborators` table: replace `(namespace, repo)` with `repository_id` FK
- [x] Migrate `namespaceMembers` table: replace `namespace` with `namespace_id` FK
- [x] Migrate `customRepoRoles` table: key by `namespace_id` FK (namespace-scoped templates)
- [x] Migrate `customNamespaceRoles` table: key by `namespace_id` FK
- [x] Migrate favorites, workspaces, jobs tables to use `repository_id` and `namespace_id`
- [x] Update audit event schema to include `repository_id`, `namespace_id`, `repository_name_snapshot`, `namespace_name_snapshot`
- [x] Create `repository_tombstones` table: `(name, deleted_at)` with check preventing name reuse for 90 days
- [x] Create `namespace_tombstones` table: `(name, deleted_at)` with check preventing name reuse for 90 days
- [x] Update all authorization query functions to use IDs
- [x] Tests verify grants persist through rename
- [x] Tests verify audit events include both IDs and name snapshots
- [x] Tests verify tombstones prevent name reuse

## Notes

Greenfield rewrite (no data backfill). Custom repo roles remain namespace-scoped templates keyed by `namespace_id` (matching prior behavior). Favorites for namespace/repo use entity UUIDs; branch/stage embed `repository_id`. Audit keeps `namespace`/`repo` as name snapshots alongside `namespace_id`/`repository_id`.
