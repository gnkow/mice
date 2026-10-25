# 06: Lineage ops live in a collection

**What to build:** Appending, pruning duplicate producers and rebuilding lineage operate on individual ops instead of rewriting the whole log.

**Blocked by:** 03-keyed-collections

**Status:** done

- [ ] Prune removes rows, not the log
- [ ] Existing lineage tests stay green
- [ ] Existing databases are migrated from the log
