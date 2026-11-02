Status: done

# 03: Session lifecycle and CSRF

**Spec:** `.specs/01-authentication.md` (U2, U4, Q51)

Idle timeout of zero is issue 33. The 30-day seal-key schedule is issue 34. The cap of five sessions is issue 15.

## Outcome

Sessions expire after 15 minutes idle (`SESSION_IDLE_SEC` default 900) and 8 hours absolute (`SESSION_TTL_SEC` default 28800). Activity updates `lastActive`. The user can list and revoke one of their own sessions. Logout destroys the server-side row and clears the cookie. Return targets are relative paths. Mutations from a cookie session require an Origin that matches the public web origin. Session cookies are sealed with the key ring from issue 17, so a rotation keeps existing sessions readable while an old key is still valid.

## Acceptance

- [x] Idle sessions expire at 15 minutes; absolute lifetime is 8 hours
- [x] A user can list and revoke any of their own sessions
- [x] Logout ends the session; a non-relative return target is rejected
- [x] The cookie key ring can unseal with any still-valid key
- [x] Cookie-session mutations without the required header or with a foreign Origin are rejected

## Code

- `auth/src/authentication/session/session.ts`
- `auth/src/authentication/session/cookieSeal.ts`
- `auth/src/authentication/session/csrf.ts`
- `auth/src/authentication/session/webSessionRoutes.ts`
- `web/src/components/WebSessionsList.tsx`
