# 03: Migrate topic route files to the request-authentication module

**What to build:** Favorites, notifications, jobs, metadata and desktop session routes authenticate through the shared module. Each deletes its local bearer-resolution helper and keeps its current responses.

**Blocked by:** 02 (Request authentication module)

**Status:** ready-for-agent

- [ ] Five route files use the shared module; their local require helpers are removed
- [ ] Favorites refuse service principals through the shared rule, not a local check
- [ ] Existing unit and e2e tests pass unchanged
