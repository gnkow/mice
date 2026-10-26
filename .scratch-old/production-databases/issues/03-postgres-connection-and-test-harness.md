# 03: The BFF connects to PostgreSQL, gates startup on the schema, and tests use the live database

**What to build:** The BFF opens a PostgreSQL connection pool through Drizzle, applies the single baseline migration on first boot, refuses to start on an unexpected schema version, and reports PostgreSQL in `/readyz`. A transaction scope helper runs async work inside a real transaction. A new test helper connects tests to the live containers, issues unique ids and deletes only rows a test created. The existing stores are unchanged (expand step).

**Blocked by:** 01, 02

**Status:** done

- [ ] Drizzle and the PostgreSQL client are installed; the baseline migration is plain SQL
- [ ] First boot on a blank database creates the schema; a mismatched version refuses to start
- [ ] `/readyz` is red when PostgreSQL is unreachable
- [ ] The transaction scope commits on success and rolls back on throw (tested)
- [ ] The test helper supplies unique ids and own-row cleanup; two parallel test files do not interfere
- [ ] `make test-unit` reports clearly when the databases are not reachable
