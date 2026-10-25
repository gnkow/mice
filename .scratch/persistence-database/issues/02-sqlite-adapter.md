# 02: SQLite adapter satisfies the persistence seam

**What to build:** A SQLite adapter (built-in `node:sqlite`, WAL, full sync) sits at the persistence seam next to the memory adapter. Documents are transactional, logs are sequence-numbered, and one contract suite proves every adapter behaves the same.

**Blocked by:** 01-notification-cursor-via-seam

**Status:** done

- [ ] One contract suite runs against the memory and SQLite adapters (documents, logs, transactions, corruption rules)
- [ ] A throwing transaction persists nothing; reads never write
- [ ] The database reopens correctly when AUTH_DATA_DIR changes between tests
- [ ] The adapter is selected from configuration (database path defaults under AUTH_DATA_DIR) and is the production default
