# 14: Mandatory Expiry for Instance Permission Grants

**What to build:** Delegated instance permission grants have mandatory expiry dates. Expired grants are automatically revoked and audited. (Outside collaborator expiry is out of scope.)

**Blocked by:** None

**Status:** done

## Check (2026-11-03)

Access review (generate / sign / UI / overdue alert) already shipped under authentication #12, #40, #41 — not part of this ticket anymore.

Outside collaborator `expires_at` is explicitly out of scope.

## Acceptance

- [x] Add `expires_at` column to instance permission grants (required for non-bootstrap delegated permissions)
- [x] Admin UI: when granting instance permissions (non-bootstrap), expiry date is a required field
- [x] Background job: check for expired instance permission grants daily, revoke expired access, audit the revocation
- [x] Tests verify delegated instance permissions require expiry date
- [x] Tests verify expired instance permission grants are revoked automatically

## Code

- `auth/drizzle/0012_instance_permission_expiry.sql`
- `auth/src/authzInstanceStore.ts` / `authzRepository.ts`
- `auth/src/instancePermissionExpiry.ts` (+ boot schedule)
- `auth/src/instanceRoutes.ts`
- `web/src/pages/SettingsPage.tsx` (`DelegatedPermissionsSection`)
- `web/src/lib/authzApi.ts`
- Tests: `instancePermissionExpiry.test.ts`, `topicRoutes.test.ts`

## Comments

- 2026-11-03: Access review delivered via auth #12/#40/#41. Scope narrowed to instance permission grant expiry only.
- 2026-11-03: Implemented with TDD (store → revoke schedule → HTTP → UI).

**Deep-api Deepen (2026-11-13):** Holds — revoke schedule + store already shipped. Auto-picked Top: deepen `runInstancePermissionExpiry` as the single revoke+audit seam (`instancePermissionExpiry.ts`); schedule only times it; store keeps persistence. Unit: injected revoke/audit in `instancePermissionExpiry.test.ts`. Integration: store revoke + schedule tick still covered there.
