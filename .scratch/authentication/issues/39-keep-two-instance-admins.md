Status: done

# 39: Keep at least two instance admins

**Spec:** `.specs/01-authentication.md` (Q25, Q67)

**Decision:** [ADR 0007](../../../docs/adr/0007-two-instance-admins.md)

**Blocked by:** none

Replaces recovery-token persistence. A one-hour two-person token is not needed when deletion cannot leave fewer than two instance admins.

## Outcome

`removeAdminKey` refuses a deletion while two or fewer instance admins remain. The API error is `At least two instance admins must remain`. Removing one admin while three remain still succeeds. The recovery-token request, approve, validate, and pending routes are gone, as are `RecoveryTokenSection` and the in-memory pending map. Settings no longer has a Recovery section. The administrators section states the floor, and Remove is disabled while two or fewer remain.

## Acceptance

- [x] Removing an instance admin while two or fewer remain is refused
- [x] Removing one admin while three or more remain still succeeds
- [x] Recovery-token routes and the settings Recovery section are gone

## Comments

- **Audit:** holds — remove/demote refused while ≤2 Admins; ≥3 still succeeds; recovery-token routes gone.
- **Deepen (auto-pick Top):** `remainingAdminIdsAfterRemoval` owns post-removal count; `decideAdminMinimum` refuses when remaining `< ADMIN_MINIMUM`; `rbacStore.breaksAdminMinimum` still loads ids then decides.
- **Files:** `adminMinimum.ts`, `rbacStore.ts` (load + call).
- **Tests:** `adminMinimum.test.ts` (unit); `rbacAdminMinimum.test.ts` (integration).
- **Seams:** `decideAdminMinimum` / `remainingAdminIdsAfterRemoval` (module); `assignRole` / `revokeRole` (package).
