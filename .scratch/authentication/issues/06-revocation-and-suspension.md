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
