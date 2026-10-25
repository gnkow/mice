# 04: Existing JSON and JSONL data is imported on first boot

**What to build:** On first boot with the database, every legacy data file is imported once, verified, and archived, so an existing deployment keeps its identities, grants, tokens, audit trail, lineage and notifications.

**Blocked by:** 02-sqlite-adapter

**Status:** done

- [ ] Every legacy document and log is imported with row counts verified
- [ ] The imported audit chain verifies and keeps its hashes
- [ ] The import is idempotent and archives originals without deleting them
- [ ] A failed import leaves the legacy files untouched and refuses to start
- [ ] Notification cursor lands on the correct sequence
