Status: done

# 18: Group overage handling

**Spec:** `.specs/01-authentication.md` (U17)

Matching grants by group object id is issue 31.

## Outcome

When the id_token carries an Entra-style group overage indicator, login fetches the user's groups from the directory and stores those names on the session. If the directory is unconfigured or the fetch returns no groups, login fails with a clear error. The directory method is `getUserGroups`. The Keycloak adapter calls the Admin API. The deployment guide describes the behaviour.

## Acceptance

- [x] `_claim_names.groups` is detected as overage
- [x] Overage fetches groups through `Directory.getUserGroups`
- [x] A failed or empty directory fetch refuses login
- [x] A login with groups already in the token does not call the directory

## Code

- `auth/src/authentication/oidc/groupOverage.ts`
- `auth/src/authentication/oidc/oidcClaims.ts`
- `auth/src/authentication/oidc/loginFlow.ts`
- `auth/src/authentication/directory/directoryKeycloak.ts`
- `docs/group-overage-handling.md`
