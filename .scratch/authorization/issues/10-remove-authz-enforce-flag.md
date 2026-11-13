Status: done

# 10: Remove AUTHZ_ENFORCE Flag

**What to build:** Authorization is always enforced. The `AUTHZ_ENFORCE` environment variable, the stored enforce flag, and every bypass that skipped a decision when enforcement was off are gone. Tests assume authorization is always on.

**Blocked by:** None

## Outcome

Decisions always run. `GET /auth/instance` and `/auth/me/authz` still report `enforce: true`. `PATCH /auth/instance` and `mice instance enforce` are gone. The `instance_settings` table is removed from the baseline schema.

## Acceptance

- [x] Remove `AUTHZ_ENFORCE` environment variable from configuration
- [x] Delete `isAuthzEnforce()` function
- [x] Remove all conditional checks: `if (await isAuthzEnforce())` → authorization always runs
- [x] Update tests to assume enforcement always on (remove toggle tests)
- [x] Remove related configuration documentation
- [x] Update deployment guides to remove AUTHZ_ENFORCE references
- [x] Tests verify authorization cannot be disabled
- [x] Tests verify unauthenticated requests are denied

## Comments

**Deep-api Deepen (2026-11-13):** Single seam `authzAlwaysOn` (`authzEnforceReport`) feeds `/auth/me/authz` and `/auth/instance`; removed stale “enforce flag” comments in `authz.ts`. Unit: `authzAlwaysOn.test.ts`.


**Deep-ui (2026-11-13):** Skipped as **no-ui** with user acknowledgment on implement. Acceptance has no UI surface to deepen under `/deep-ui`.
