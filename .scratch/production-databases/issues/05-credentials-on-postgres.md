# 05: PATs, service principals, device login and revocation live in PostgreSQL

**What to build:** Credential records (PATs, service principals and their expiry, CLI device codes, admin session revocation cut-offs) are typed tables with a unique token-hash constraint, asynchronous and transactional. The in-memory credential store is removed.

**Blocked by:** 03

**Status:** done

- [ ] Token hash is unique in the database and lookups use it
- [ ] Revocation cut-offs reject PATs minted before them, unchanged
- [ ] The memory credential store is deleted and its tests use the live database
- [ ] Scoped PAT and CLI auth targeted e2e pass
