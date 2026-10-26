# 03: Memory adapter has real transactions

**What to build:** Tests see the same all-or-nothing behaviour as the database: a failure inside atomically leaves every document, log and collection as it was.

**Blocked by:** None

**Status:** done

- [ ] Rollback restores documents, logs and collection rows
- [ ] Nested atomically joins the outer one
