# 01: Audit append reads only the newest row

**What to build:** Appending an audit event no longer reads the whole trail; the hash chain continues from the newest row, on every adapter.

**Blocked by:** None

**Status:** done

- [ ] Append-only log can return its first and newest rows
- [ ] Chain append and genesis checks read one row
- [ ] Verification still checks every row
