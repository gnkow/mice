Status: done

# 06: Revocation and suspension

**Spec:** `.specs/01-authentication.md` (stories 6, 11, and 12, Q39, R8, Q65)

Mice-only suspension flags that keep grants are issue 28. Job commit blocking after revoke is `.scratch/jobs/issues/02-job-token-lifetime-and-commit-refusal.md`.

## Outcome

An admin can revoke all sessions and credentials for a Principal. Security-role suspend needs a second, different admin within 24 hours; an unconfirmed suspend lapses. Pending suspension requests and consumed back-channel `jti` values are stored in Postgres. A Principal can self-suspend. A role or grant change sets a session cutoff so the next request requires a fresh login. Revoke and suspend return 503 when the audit record cannot be written. `openSession` checks revocation on every open, with no revocation cache. Back-channel logout validates the logout token and rejects `jti` replay. The admin UI exposes revoke and suspend.

## Acceptance

- [x] A revoked or suspended Principal receives `ACCESS_REVOKED` on the next request, with no revocation cache
- [x] Revoke and suspend return 503 when the audit write fails
- [x] A second, different admin must confirm suspend within 24 hours; otherwise it lapses
- [x] A role or grant change forces a fresh login
- [x] Back-channel logout validates signature, issuer, audience, events, and nonce, and rejects `jti` replay

## Code

- `auth/src/authentication/access/revocation.ts`
- `auth/src/authentication/access/adminRevocationRoutes.ts`
- `auth/src/authentication/oidc/backChannelLogout.ts`
- `auth/src/authentication/session/session.ts` (`openSession`)
- `web/src/components/AdminRevocationSection.tsx`

## Comments

- **Audit:** holds — revoke/suspend/confirm/self/role-change, live checks (no cache), 503 on audit Intent failure, and back-channel `jti` consume proven by `revocation.test.ts` and `revocation.persistent.test.ts`.
- **Deepen (auto-pick Top):** Collapsed the shallow Intent→mutate→Outcome dance into one deep `runAuditedAccessMutation` in `revocation.ts`. Every admin/self/role-change path goes through that seam so 503-before-write locality lives once. Confirm failures use `SuspensionConfirmError` (`not_found` | `same_admin`); `adminRevocationRoutes` maps those codes instead of brittle message substrings. Session/`openSession` untouched.
