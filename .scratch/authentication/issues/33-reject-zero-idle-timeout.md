Status: done

# 33: Idle timeout of zero is refused at startup

**Spec:** `.specs/01-authentication.md` (U2, U22)

Split from issues 03 and 20. U22 says strict behaviour is always on.

## Outcome

`GXP_STRICT` is removed. Every start refuses unless `SESSION_IDLE_SEC` is a number greater than zero, including when the variable is unset, zero, or negative. A positive value starts. Signing and session expiry keep using that configured value. Compose and `.env.example` set 900 seconds.

## Acceptance

- [x] Startup fails when `SESSION_IDLE_SEC` is unset, zero, or negative, with `GXP_STRICT` unset
- [x] Startup succeeds when `SESSION_IDLE_SEC` is a positive value
- [x] A test that previously set idle timeout to zero is updated to expect the startup failure

## Code

- `auth/src/authentication/session/startupGate.ts`
- `compose.yaml`
- `.env.example`
