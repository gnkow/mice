# 06: Compose runs the database, with backup and health

**What to build:** The compose stack runs the BFF on the database with its data on the existing volume, offers an online backup command, and reports storage health.

**Blocked by:** 03-append-only-enforced, 04-legacy-import

**Status:** done

- [ ] Compose sets the database path and starts cleanly from an old volume and from an empty one
- [ ] A backup command produces a consistent copy while the stack runs, and a restore is documented
- [ ] Readiness fails when the database is unwritable
- [ ] Operations plan, README, glossary and an ADR record the decision (SQLite over Postgres) and what stays on disk
