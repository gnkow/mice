# 02: Unchanged documents are not rewritten

**What to build:** A transaction that changes nothing writes nothing, and the per-request notification user refresh writes at most once a minute per user.

**Blocked by:** None

**Status:** done

- [ ] Document transaction with no change performs no write
- [ ] Refreshing a remembered user twice within a minute writes once
- [ ] Existing staleness behaviour of claimsAt keeps working
