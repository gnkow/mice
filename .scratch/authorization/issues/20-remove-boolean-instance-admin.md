Status: needs-triage

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

- [ ] No code path grants permissions from `admin_keys`; the Admin role is the only source
- [ ] Bootstrap (`AUTHZ_BOOTSTRAP_ADMINS`) assigns the Admin role only
- [ ] "At least two admins must remain" is enforced on the Admin role
- [ ] The training exemption and `userHasAnyGrant` use the role, not the flag
- [ ] e2e suite cleanup works without `instanceAdmin: true`
- [ ] `admin_keys` and its migration path are removed
