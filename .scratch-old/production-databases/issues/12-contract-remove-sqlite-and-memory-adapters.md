# 12: SQLite, the memory adapter and the generic store seam are removed

**What to build:** With every store on its production database, the SQLite adapter, the memory adapter, the generic JSON backend seam, the document, collection and log store interfaces and the old test helper are deleted. Disk state (workspace state, base, leases, caches) keeps its disk document module. The data directory lock guards only the workspace disk. Remaining tests use the live-database helper.

**Blocked by:** 04, 05, 06, 07, 08, 09, 10

**Status:** done

- [ ] `node:sqlite`, the SQLite adapter and the memory adapter no longer appear in the code
- [ ] No test uses `useJsonBackend` or `createMemoryJsonBackend`
- [ ] Type check passes; the unit loop passes against the live containers
- [ ] The data directory lock covers only the workspace disk
- [ ] Targeted e2e passes (authz, jobs, workspaces-advanced, notifications)

## Outcome

Deleted `jsonStore`, `sqliteBackend`, `stores` and their tests; `node:sqlite` and `AUTH_DATABASE_PATH` are gone. `diskStore.ts` keeps the disk document and `diskReadiness()` (`/readyz` `storage`). `isolatedAuth` no longer has a memory backend; it creates a private data directory and removes it. Remaining memory-backed tests moved to the live PostgreSQL helper. The session mount compatibility fields (`workspace_ref`, `pin_commit`, `mount_path` mirrors) are part of the public API shape and were left alone.
