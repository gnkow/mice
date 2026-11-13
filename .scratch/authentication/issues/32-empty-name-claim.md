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
