# 11: Remove AUTHZ_GROUP_BOOTSTRAP Flag

**What to build:** Remove automatic grant provisioning based on IdP group membership. No IdP groups automatically grant instance permissions or namespace membership. Managers grant access explicitly through the admin UI. The `AUTHZ_GROUP_BOOTSTRAP` environment variable and all group-based autoprovisioning logic are deleted.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Remove `AUTHZ_GROUP_BOOTSTRAP` environment variable from configuration
- [ ] Delete group-based autoprovisioning logic (IdP group → automatic grants)
- [ ] Managers grant access directly via admin UI (no automatic grants)
- [ ] Update bootstrap documentation to remove group provisioning references
- [ ] Remove group bootstrap configuration examples
- [ ] Tests verify no automatic grants from IdP groups
- [ ] Tests verify managers can grant access manually
- [ ] Tests verify users from specific IdP groups do not get automatic permissions
