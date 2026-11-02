Status: done

# 20: Idle timeout at signing

**Spec:** `.specs/01-authentication.md` (U2)

Refusing a zero idle timeout at startup is issue 33.

## Outcome

`sessionIdleSec` defaults to 900. Signing prepare and execute refuse when `now - lastActive` is greater than that value. The error tells the signer to re-authenticate. Session activity and a new login move `lastActive` forward.

## Acceptance

- [x] The default idle timeout is 900 seconds
- [x] Signing is refused when the session has been idle longer than `sessionIdleSec`
- [x] Signing proceeds when the last activity is inside the window

## Code

- `auth/src/env.ts`
- `auth/src/authentication/signing/signingRoutes.ts` (`checkIdleTimeout`)
- `auth/src/authentication/signing/idleTimeout.test.ts`
