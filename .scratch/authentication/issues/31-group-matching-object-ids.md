Status: done

# 31: Group matching by object id

**Spec:** `.specs/01-authentication.md` (Q62)

Previously filed as `09-group-matching-object-ids.md`. Fetching groups after an overage claim is issue 18. Login does not create a group grant; an administrator records one.

## Outcome

Namespace and repository group grants are stored as the IdP group object id. Directory search and `getUserGroups` return that id and the current display name. Login puts the id on the session and keeps the token's group name so a grant that has not been filled yet still matches. Authorization matches the id. A rename in the IdP leaves the grant in place, and the member list shows the directory's current name. The audit event for the grant records the display name sent when it was written. Opening a namespace rewrites a stored display name to the object id when the directory has exactly one group by that name, and reports a name the IdP no longer has.

## Acceptance

- [x] Keycloak `getUserGroups` and group search return the group object id and the current name
- [x] Session groups and group grants store the object id
- [x] Authorization matches the object id
- [x] Renaming the group in the IdP leaves the grant effective, and the UI shows the new name
- [x] A migration fills ids for existing name-based grants and reports names that the IdP no longer has

## Code

- `auth/src/authentication/directory/directoryGroupOid.ts`
- `auth/src/authentication/directory/directoryKeycloak.ts`
- `auth/src/authentication/oidc/loginFlow.ts`
- `auth/src/authzMembershipStore.ts`
- `auth/src/namespaceRoutes.ts`
- `web/src/pages/NamespaceSettingsPage.tsx`

## Comments

- **Audit:** holds — Keycloak group search/`getUserGroups` return object id + display name; session/grants/authz match on id; rename-safe.
- **Deepen (auto-pick Top):** `directoryGroupGrantKey` owns UUID lowercasing + name normalization; `mapKeycloakGroupRow` / `mapKeycloakDirectoryGroup` map rows through that seam; `directoryKeycloak` / `loginFlow` untouched.
- **Tests:** `directoryGroupOid.test.ts` (unit); `directoryAdapters.test.ts` (integration).
- **Seams:** `directoryGroupGrantKey` / `mapKeycloakGroupRow` (module); Keycloak adapter (package).

2026-11-13: deep-api Deepen (holds) — auto-picked Top architecture recommendation; unit+integration strengthened at ticket seams; Status remains done.
