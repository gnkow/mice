Status: done

# 32: Refuse login when the name claim is empty

**Spec:** `.specs/01-authentication.md` (T8)

Split from issue 02.

## Outcome

The display name comes from the IdP user record read during the status check (`firstName` and `lastName`). Login, an authenticated request, and a CLI credential refresh are refused when that name is empty. The BFF does not invent a name from `preferred_username`, the email, or `sub`. A refused login is audited as `auth.login.failed` and the audit record does not contain the id_token or the authorization code. No Session is created. A user the IdP names still signs in, and the Session stores that name.

## Acceptance

- [x] An id_token with an empty or absent `name` claim fails login
- [x] The session is not created
- [x] The failure is audited without the token or the code
- [x] A present `name` claim still logs the user in

## Code

- `auth/src/authentication/oidc/idpDisplayName.ts`
- `auth/src/authentication/directory/directoryKeycloak.ts`
- `auth/src/authentication/oidc/loginFlow.ts` (empty-name gate line only)
- `auth/src/authentication/session/requireAuth.ts`
- `auth/src/authentication/oidc/oidcClaims.ts`

## Comments

- **Audit:** holds (`emptyName.test.ts`, IdP status-check refusal).
- **Deepen:** extracted `composeIdpDisplayName` / `hasIdpDisplayName` helper; directory compose + login/requireAuth gates call it; loginFlow touched only on the empty-name line.
- **Tests:** `auth/src/authentication/oidc/idpDisplayName.test.ts`, `auth/src/authentication/oidc/emptyName.test.ts`.

2026-11-13 — deep-api Deepen (auto-pick Top): **holds** + integration gap closed.
- **Seams:** `decideIdpDisplayNameGate` / `composeIdpDisplayName`; login + `evaluateLiveIdpAccess` adapters.
- **Deepen:** Collapse refuse copy/status into `decideIdpDisplayNameGate` (in-process). `loginFlow` empty-name line + live IdP access call it; no wholesale requireAuth rewrite.
- **Integ:** `emptyName.integration.test.ts` — login refuses blank directory name; `evaluateLiveIdpAccess` returns 403; named IdP still signs in.
- **Files:** `idpDisplayName.ts`, `idpDisplayName.test.ts`, `idpCheck.ts`, `loginFlow.ts` (gate line), `emptyName.integration.test.ts`.

2026-11-13 — deep-ui Deepen (holds → UI surface):
- **Surfaces:** `LoginPage` `?status=empty_name` alert; callback sets `surface: 'empty_name'` on refuse.
- **Deepen:** Titled alert with EMPTY_IDP_DISPLAY_NAME copy; focusable `role=alert`.
- **E2E:** `e2e/tests/login-status.spec.ts` — empty_name case. Run: `npm run test:e2e -- e2e/tests/login-status.spec.ts`
- **Status:** done
