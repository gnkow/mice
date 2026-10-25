# 06: Jobs, job aliases, lineage and Desktop Session records live in PostgreSQL

**What to build:** Job runs, job aliases, lineage and Desktop Session records are typed tables with asynchronous access. Filtering by field uses SQL, not document scans. Workspace trees, leases and job logs stay on disk.

**Blocked by:** 03

**Status:** done

- [ ] Job, lineage and session stores are PostgreSQL-only and asynchronous
- [ ] Listing and lookup by field use indexed columns
- [ ] Job routes, runners and the sessions module await the stores
- [ ] Legacy job fields and inputs (`branch`, `pin_commit`, `workspace_id`, `job_ids` submit, `normalizeJob` legacy readers) are removed
- [ ] Tests use unique ids and own-row cleanup
- [ ] Targeted e2e passes (jobs, lineage); the known mock-session failure is unchanged
