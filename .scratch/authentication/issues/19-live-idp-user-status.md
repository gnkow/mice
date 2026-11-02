Status: done

# 19: Live IdP check on authenticated requests

**Spec:** `.specs/01-authentication.md` (U3, user-status half)

Group refresh on privileged operations is issue 37. The login status code when the directory is unreachable is issue 38. Login-time disabled and missing checks are issue 04.

## Outcome

`authenticate` calls `verifyIdpAccess` on every authenticated request. There is no `lastIdpCheck` field and no 5-minute throttle. A disabled user or an unreachable directory returns 503. Ordinary reads keep the groups captured on the session. Those groups age out with the 8-hour session lifetime.

## Acceptance

- [x] Every authenticated request checks IdP user status
- [x] An unreachable directory or a disabled user returns 503
- [x] Sessions do not store a last-check timestamp
- [x] Ordinary reads use the groups stored on the session

## Code

- `auth/src/authentication/access/idpCheck.ts`
- `auth/src/authentication/session/requireAuth.ts`
