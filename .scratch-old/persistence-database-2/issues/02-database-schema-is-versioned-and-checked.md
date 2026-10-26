# 02: Database schema is versioned and checked at boot

**What to build:** The database records a schema version, applies ordered migrations once, refuses a database from a newer version, and checks integrity at boot and in readiness.

**Blocked by:** None (can start immediately)

**Status:** done

- [ ] A fresh database is at the latest version
- [ ] An older database is migrated in one transaction and a failed migration changes nothing
- [ ] A newer database refuses to open
- [ ] Integrity check failure refuses startup and fails readiness
