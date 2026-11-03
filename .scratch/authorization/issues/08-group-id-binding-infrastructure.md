# 08: Group ID Binding - Schema and Extraction

**What to build:** Group bindings reference IdP group IDs (Azure AD GUIDs, Keycloak group IDs) rather than normalized group names. Schema stores `iss|group_id` as the group key. Display names cached in a separate table for UI presentation. When a user logs in and their groups are checked, the system uses immutable group IDs, so renaming a group in the IdP does not break access grants.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Update group binding schema: `groupKey` stores `"iss|group_id"` instead of normalized name
- [x] Create `group_display_names` table: `(group_id, issuer, display_name, last_updated)`
- [x] Extract group IDs from IdP claims (Azure AD `groups` claim contains GUIDs, Keycloak provides group IDs)
- [x] Display name cache refreshed on user login (populate from claims)
- [x] Update group binding functions to use group IDs
- [x] UI shows display names from cache (not raw IDs)
- [x] Fallback: if IdP doesn't provide group IDs, store normalized name as ID with warning flag
- [x] Tests verify group binding uses IDs from Azure AD
- [x] Tests verify group binding uses IDs from Keycloak
- [x] Tests verify display names cached and used in UI
- [x] Tests verify fallback to names when IDs unavailable

## Notes

- Greenfield: no name→id rewrite (`reconcileNamespaceGroupIds` is a no-op)
- Keys: `auth/src/groupBinding.ts` (`groupBindingKey`, `extractGroupsFromClaims`)
- Cache: `group_display_names` + `auth/src/groupDisplayStore.ts`; login refreshes via `sessionGroups`
- Warning: `groupsNameBasedFallback` on Session / OIDC claims when any claim lacked an object id
