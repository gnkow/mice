# 04: Authorization data lives in typed PostgreSQL tables

**What to build:** Namespaces, members, collaborators, custom roles, access requests, bootstrap admins and the authorization repository use typed tables with keys and foreign keys, asynchronous calls and real transactions. The undo logic in multi-document changes is removed. Authorization behaviour through the HTTP app is unchanged.

**Blocked by:** 03

**Status:** done

- [ ] Each store is asynchronous and reads and writes PostgreSQL only
- [ ] Multi-step changes (for example namespace plus membership) run in one transaction
- [ ] The database enforces uniqueness and referential integrity
- [ ] Callers (routes, guards, directory sync) are awaited correctly
- [ ] Tests use unique ids and delete their own rows; existing behaviour tests pass
- [ ] Targeted e2e passes (authz, deny-paths, workspaces-advanced)
