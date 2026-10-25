# 02: Legacy migration, grandfathering and backup code are deleted

**What to build:** Boot no longer imports legacy JSON/JSONL, migrates identity keys, converts the meta document, or replays v1-v5 migrations. Legacy field readers (grandfathered token expiry, legacy favorite types, legacy job branch fields, legacy notification document handling) are gone. Backup, restore and maintenance code, their schedules, variables and make targets are deleted. The app still boots and passes its tests on the current SQLite adapter, whose schema collapses to one baseline.

**Blocked by:** None (can start immediately)

**Status:** done

- [ ] Legacy importer, identity migration and meta migration modules and their boot calls are removed
- [ ] SQLite migrations collapse to a single baseline schema
- [ ] Domain types contain no legacy fields; document `migrate` and `onCorrupt` hooks are removed
- [ ] Backup, restore, maintenance, `db-tool` script, make targets and env variables are removed
- [ ] Unit tests for the deleted code are removed; remaining tests pass
- [ ] Targeted e2e still passes (authz, jobs)
