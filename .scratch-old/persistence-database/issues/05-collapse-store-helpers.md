# 05: One store interface instead of three helpers

**What to build:** Every document store uses the same interface, with one corruption rule, and the redundant helpers are deleted. Behaviour is unchanged.

**Blocked by:** 02-sqlite-adapter

**Status:** done

- [ ] No module calls the raw JSON read/write helpers or the typed store helper
- [ ] Each converted store keeps its existing tests green
- [ ] The now-unused helpers are deleted
