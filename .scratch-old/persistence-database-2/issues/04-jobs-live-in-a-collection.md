# 04: Jobs live in a collection

**What to build:** Updating a Job touches one record; rekeying a provisional id to a result commit id is one transaction, so no crash window leaves duplicates.

**Blocked by:** 03-keyed-collections

**Status:** done

- [ ] Job upsert no longer rewrites the store
- [ ] Rekey is atomic and rollback-safe
- [ ] Existing job tests stay green
- [ ] Existing databases are migrated from the log
