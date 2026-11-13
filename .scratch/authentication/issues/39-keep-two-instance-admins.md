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

2026-11-13: Checkmate audit — **holds** (acceptance green at `assignRole` / `revokeRole` via `breaksAdminMinimum`; proving test `rbacAdminMinimum.test.ts`).

**Deepen (auto-pick):** Collapse floor arithmetic into deep `decideAdminMinimum({ activeAdminIds, targetPrincipalId })` (in-process). `rbacStore` loads active Admin ids; the decision owns the ≤2 refuse / ≥3 allow. Error string stays behind that seam.

**Files:** `auth/src/adminMinimum.ts`, `auth/src/adminMinimum.test.ts`, `auth/src/rbacStore.ts`

**Tests:** `adminMinimum.test.ts`; regression `rbacAdminMinimum.test.ts`
