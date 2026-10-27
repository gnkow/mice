# 10: Remove AUTHZ_ENFORCE Flag

**What to build:** Authorization is always enforced in production. Remove the `AUTHZ_ENFORCE` environment variable and all conditional logic checking if authorization should be enforced. The `isAuthzEnforce()` function and all its call sites are deleted. Tests assume authorization is always on.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Remove `AUTHZ_ENFORCE` environment variable from configuration
- [ ] Delete `isAuthzEnforce()` function
- [ ] Remove all conditional checks: `if (await isAuthzEnforce())` → authorization always runs
- [ ] Update tests to assume enforcement always on (remove toggle tests)
- [ ] Remove related configuration documentation
- [ ] Update deployment guides to remove AUTHZ_ENFORCE references
- [ ] Tests verify authorization cannot be disabled
- [ ] Tests verify unauthenticated requests are denied
