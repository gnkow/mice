Status: done

# 11: Remove AUTHZ_GROUP_BOOTSTRAP Flag

**What to build:** Remove automatic grant provisioning based on IdP group membership. No IdP groups automatically grant instance permissions or namespace membership. Managers grant access explicitly through the admin UI. The `AUTHZ_GROUP_BOOTSTRAP` environment variable and all group-based autoprovisioning logic are deleted.

**Blocked by:** None

## Outcome

`preparePrincipal` grants instance admin only for `AUTHZ_BOOTSTRAP_ADMINS`. The JSON map, `applyGroupBootstrap`, and the environment variable are gone. An access request is how a new Principal asks for access. A namespace or repository group grant still applies when an administrator has recorded that group.

## Acceptance

- [x] Remove `AUTHZ_GROUP_BOOTSTRAP` environment variable from configuration
- [x] Delete group-based autoprovisioning logic (IdP group → automatic grants)
- [x] Managers grant access directly via admin UI (no automatic grants)
- [x] Update bootstrap documentation to remove group provisioning references
- [x] Remove group bootstrap configuration examples
- [x] Tests verify no automatic grants from IdP groups
- [x] Tests verify managers can grant access manually
- [x] Tests verify users from specific IdP groups do not get automatic permissions

## Comments

**Deep-api Deepen (2026-11-13):** Single seam `principalBootstrap` (`runPrincipalBootstrap`) owns allowlist-only Admin bootstrap at `preparePrincipal`; IdP groups never write instance/namespace grants. Removed group-bootstrap surface from the prepare path. Unit: `principalBootstrap.test.ts` (no `AUTHZ_GROUP_BOOTSTRAP` on env; groups leave Principal pending; no user membership created; `AUTHZ_BOOTSTRAP_ADMINS` still works).
