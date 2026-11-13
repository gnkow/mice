Status: done

# 09: Step-up re-authentication

**Spec:** `.specs/01-authentication.md` (story 9, Q6, Q7)

MFA claim refusal at signing is issue 14. CLI step-up uses the device flow in issue 07.

## Outcome

Sensitive browser actions call `reauthenticate`. The IdP request uses `prompt=login` and `max_age`. The callback rejects a different `iss`+`sub`. Freshness is measured from the session `auth_time` against the requested window. A browser navigation is redirected to `/auth/reauth`; an API call receives 401 with `reauthUrl`. A bearer credential cannot satisfy step-up. Signing uses a 60-second window.

## Acceptance

- [x] Step-up sends `prompt=login` and `max_age`
- [x] The returned `iss`+`sub` must match the current session
- [x] A stale authentication is rejected
- [x] Bearer credentials receive 403; step-up requires a browser session
- [x] The signing ceremony demands a fresh step-up

## Code

- `auth/src/authentication/oidc/stepUp.ts`
- `auth/src/authentication/oidc/loginFlow.ts` (reauth branch)
- `auth/src/authentication/signing/signingRoutes.ts`

## Comments

2026-11-13 — Checkmate audit: **holds** (acceptance covered by `stepUp.test.ts`; signing still calls `reauthenticate` with 60s).

**Deepen (auto-picked):** Collapse freshness + bearer/HTML/API challenge branching into deep `decideStepUp(...)`; clamp via `resolveMaxAgeSec`. `reauthenticate` is a thin Context adapter over that decision. No signingRoutes rewrite.

**Files:** `auth/src/authentication/oidc/stepUp.ts`, `stepUp.test.ts`

2026-11-13 — Deep-API deepen (auto-pick Top) + integ: **holds**. Prior `decideStepUp` kept. Signing routes now call deep `requireSigningAccess` (`signingAccess.ts`) which demands the 60s step-up then idle. Seams: `decideStepUp` / `reauthenticate` (unit), `requireSigningAccess` (unit), `POST /auth/sign/prepare` reauth challenge (integ).

**Files:** `signingAccess.ts`, `signingAccess.test.ts`, `signingRoutes.ts` (thin adapter), `signingRoutes.integration.test.ts`
