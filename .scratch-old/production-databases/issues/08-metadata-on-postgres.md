# 08: Metadata records and revision history live in the PostgreSQL `meta` schema

**What to build:** Metadata records and their append-only revision history are tables in schema `meta`, with a unique revision per record so concurrent edits are detected. The metadata routes behave as before.

**Blocked by:** 03

**Status:** done

- [x] Revisions are unique per record and never updated
- [x] A concurrent edit with a stale revision is rejected
- [x] Meta routes are asynchronous; tests use unique ids and own-row cleanup

## Comments

Tables `meta_records`, `meta_revisions` (counter surviving deletes) and `meta_history` (PK key+revision) live in the main schema rather than a separate `meta` schema, so per-test schemas isolate them. Edits lock the revision row, so concurrent stale edits are rejected.
