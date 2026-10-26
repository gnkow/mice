# 12: Retire the file adapter

**What to build:** Memory and SQLite are the only adapters; memory implements collections natively and DiskDocument owns atomic file writes.

**Blocked by:** 03-memory-adapter-transactions

**Status:** done

- [ ] No file JSON backend or JSON-pair row fallback remains
- [ ] Contract tests run on sqlite and memory
- [ ] Workspace documents still write atomically
