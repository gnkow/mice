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
- `auth/src/authentication/signing/idleTimeout.ts`
- `auth/src/authentication/signing/signingRoutes.ts` (thin `checkIdleTimeout` adapter)
- `auth/src/authentication/signing/idleTimeout.test.ts`

## Comments

2026-11-13 — Checkmate audit: **holds** (default 900 + idle refuse/allow at signing).

**Deepen (auto-picked):** Extract inlined idle logic from `signingRoutes` into deep `evaluateSigningIdle` / `checkSigningIdleTimeout` in `idleTimeout.ts`. Routes stay a one-line adapter; tautological tests replaced with real seam tests.

**Files:** `idleTimeout.ts`, `idleTimeout.test.ts`, `signingRoutes.ts` (minimal)

2026-11-13 — Deep-API deepen (auto-pick Top) + integ: **holds**. Idle decision stays in `evaluateSigningIdle`; routes call it via `requireSigningAccess` (no local wrapper). Unit: idle refuse/allow + `requireSigningAccess` `session_idle` branch. Integ: `POST /auth/sign/prepare` refuses idle Sessions (loadSession expiry or signing gate).

**Files:** `idleTimeout.ts`, `signingAccess.ts`, `signingRoutes.ts` (adapter), `signingAccess.test.ts`, `signingRoutes.integration.test.ts`

2026-11-13: /deep-ui skipped — no-ui (API/CLI/boot acceptance only). User acknowledged skip on authentication deep-ui board.
