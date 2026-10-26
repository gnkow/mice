# 05: Credentials are a collection

**What to build:** Using a token updates one row, lookup is by hash, and the grandfathering of legacy expiry still happens once.

**Blocked by:** None

**Status:** done

- [ ] touch writes one row, not every token
- [ ] findByHash does not parse every token
- [ ] Existing PAT data is migrated (schema v4) and the importer maps pats.json
