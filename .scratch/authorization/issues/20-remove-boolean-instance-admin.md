Status: done

# 20: Remove the boolean instance-admin flag

**Follow-up to:** `16-role-based-access-control.md` (locked decision: "Wipe ... instance-admin flags")

## Problem

Ticket 16 locked the cutover to the Admin role, with no boolean superuser. The `admin_keys` flag and its code paths still exist beside the role:

- `authzInstanceStore.ts`: `isInstanceAdmin`, `addInstanceAdmin`, `removeInstanceAdmin`, `maybeBootstrapInstanceAdmin`; `instancePermissions` returns every permission for a boolean admin
- `authz.ts`: `isUnscopedInstanceAdmin`; the training requirement is skipped for a boolean admin
- `authzVisibility.ts`: `userHasAnyGrant` returns true for a boolean admin
- `authzMembershipStore.ts`: separation-of-duties check uses the flag
- `authentication/session/devSessionRoutes.ts` and e2e `instanceAdmin: true`: suite cleanup relies on the flag

The two models can disagree: a Manager with the flag gets all instance permissions, while its role says otherwise.

## Acceptance

- [x] No code path grants permissions from `admin_keys`; the Admin role is the only source
- [x] Bootstrap (`AUTHZ_BOOTSTRAP_ADMINS`) assigns the Admin role only
- [x] "At least two admins must remain" is enforced on the Admin role
- [x] The training exemption and `userHasAnyGrant` use the role, not the flag
- [x] e2e suite cleanup works without `instanceAdmin: true`
- [x] `admin_keys` and its migration path are removed

## Comments

**Done.** `isInstanceAdmin` is now "holds the Admin role"; `instancePermissions` returns only delegated grants (no implicit "all"). `maybeBootstrapInstanceAdmin` assigns the Admin role. `assignRole`/`revokeRole` refuse to take the role from the last two admins (`rbacAdminMinimum.test.ts`). The `instance_admins` table, `add/removeInstanceAdmin`, the `/auth/instance/admins` routes, the Settings add/remove form, the CLI `instance admin` command and the dev-session `instanceAdmin` flag are gone; the single baseline migration was regenerated. e2e cleanup mints an `admin`-role identity.

**Deep-api Deepen (2026-11-13):** Holds at Admin-role-only `isInstanceAdmin`. Top: pure `decideIsInstanceAdmin({ role, canBeAdmin })`; store loads then decides. Dead `addInstanceAdmin` import already gone from `instanceAdminSeparation.test.ts`. Unit: `decideIsInstanceAdmin` + delegated-perms-are-not-admin. Integration: SoD suite asserts Admin-role holders via `isInstanceAdmin`.
