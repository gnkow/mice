# 03: Migrate Authorization Stores to Entity IDs

**What to build:** All authorization-related tables (collaborators, members, custom roles, favorites, workspaces, jobs) reference repositories and namespaces by stable UUID, not by name strings. Audit events store both the stable ID and a human-readable name snapshot at the time of the event. Tombstone tables prevent reuse of deleted/renamed entity names for a period. After this ticket, renaming a repository or namespace does not orphan any grants, favorites, or audit trail.

**Blocked by:** 01 (Stable Repository IDs Infrastructure), 02 (Stable Namespace IDs Infrastructure)

**Status:** ready-for-agent

- [ ] Migrate `repoCollaborators` table: replace `(namespace, repo)` with `repository_id` FK
- [ ] Migrate `namespaceMembers` table: replace `namespace` with `namespace_id` FK
- [ ] Migrate `customRepoRoles` table: add `repository_id` FK
- [ ] Migrate `customNamespaceRoles` table: add `namespace_id` FK
- [ ] Migrate favorites, workspaces, jobs tables to use `repository_id` and `namespace_id`
- [ ] Update audit event schema to include `repository_id`, `namespace_id`, `repository_name_snapshot`, `namespace_name_snapshot`
- [ ] Create `repository_tombstones` table: `(name, deleted_at)` with check preventing name reuse for 90 days
- [ ] Create `namespace_tombstones` table: `(name, deleted_at)` with check preventing name reuse for 90 days
- [ ] Update all authorization query functions to use IDs
- [ ] Tests verify grants persist through rename
- [ ] Tests verify audit events include both IDs and name snapshots
- [ ] Tests verify tombstones prevent name reuse
