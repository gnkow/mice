# 04: Namespace changes commit atomically

**What to build:** Creating, deleting and updating namespaces writes all documents in one transaction; the hand-rolled undo list is gone.

**Blocked by:** 03-memory-adapter-transactions

**Status:** done

- [ ] A failing write leaves namespaces, members and collaborators untouched
- [ ] commit/undo helpers removed
- [ ] Existing authz failure-injection tests stay green
