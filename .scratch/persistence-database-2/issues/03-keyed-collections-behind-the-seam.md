# 03: Keyed collections behind the seam

**What to build:** Stores of records identified by id can add, replace, remove and list a single record without rewriting the others, with the same behaviour on file, memory and database adapters, and grouped writes commit together.

**Blocked by:** 02-schema-versioned

**Status:** done

- [ ] One contract suite passes on all three adapters
- [ ] Put, get, remove, list, count are single-record operations on the database
- [ ] Writes inside a transaction roll back together
- [ ] Corrupt rows are skipped by one rule
