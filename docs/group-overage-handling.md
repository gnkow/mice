# Group Overage Handling

## Overview

When a user belongs to many groups (typically >200), some Identity Providers (IdPs) cannot include all groups in the id_token due to size limits. Instead, they return an **overage indicator** and require a separate API call to fetch the full group list.

Mice automatically detects group overage and falls back to the directory API to fetch groups.

## How It Works

### Normal Login (No Overage)
```
1. User authenticates with IdP
2. IdP returns id_token with groups: ["devs", "admins"]
3. Mice stores groups in session
4. Login succeeds
```

### Overage Detected
```
1. User authenticates with IdP
2. IdP returns id_token with:
   - groups: [] (empty)
   - _claim_names.groups: "src1" (overage indicator)
3. Mice detects overage indicator
4. Mice calls directory API: GET /users/{id}/groups
5. Directory returns 237 groups
6. Mice stores groups in session
7. Login succeeds
```

### Overage + Directory Failure
```
1. User authenticates with IdP
2. IdP returns overage indicator
3. Mice calls directory API
4. Directory API fails (network error, permission denied, etc.)
5. Login fails with 500: "Group membership could not be determined"
6. User cannot login (fail-closed)
```

## Supported IdPs

### Microsoft Entra ID (Azure AD)

**Overage Threshold:** ~200 groups (varies by token size)

**Overage Indicator:**
```json
{
  "iss": "https://login.microsoftonline.com/{tenant-id}/v2.0",
  "sub": "AAAAAAAAAAAAAAAAAAAAAAgk0...",
  "email": "alice@example.com",
  "_claim_names": {
    "groups": "src1"
  },
  "_claim_sources": {
    "src1": {
      "endpoint": "https://graph.microsoft.com/v1.0/users/{id}/getMemberObjects"
    }
  }
}
```

**Directory API:**
- Endpoint: `GET https://graph.microsoft.com/v1.0/users/{id}/memberOf`
- Alternative: `POST https://graph.microsoft.com/v1.0/users/{id}/getMemberObjects` (recommended for >2000 groups)
- Authentication: App-only access token with `User.Read.All`, `GroupMember.Read.All`

**Configuration:**
```env
DIRECTORY_PROVIDER=keycloak  # Or "graph" for direct Microsoft Graph
KEYCLOAK_ADMIN_URL=https://graph.microsoft.com/v1.0
KEYCLOAK_REALM=users
OIDC_ISSUER=https://login.microsoftonline.com/{tenant-id}/v2.0
OIDC_CLIENT_ID={app-client-id}
OIDC_CLIENT_SECRET={app-client-secret}
```

**Azure Portal Setup:**
1. Register application in Azure Portal
2. Add API permissions:
   - Microsoft Graph → Application permissions
   - `User.Read.All` (read user profiles)
   - `GroupMember.Read.All` (read group memberships)
3. Grant admin consent for permissions
4. Create client secret
5. Copy tenant ID, client ID, client secret to env vars

**Testing:**
```bash
# Fetch access token
curl -X POST "https://login.microsoftonline.com/{tenant-id}/oauth2/v2.0/token" \
  -d "client_id={client-id}" \
  -d "client_secret={client-secret}" \
  -d "scope=https://graph.microsoft.com/.default" \
  -d "grant_type=client_credentials"

# Test group fetch
curl "https://graph.microsoft.com/v1.0/users/{user-id}/memberOf" \
  -H "Authorization: Bearer {access-token}"
```

**Limitations:**
- Requires app-only access (not delegated)
- Admin consent required for `GroupMember.Read.All`
- Rate limit: 10,000 requests/10 minutes per app

### Keycloak

**Overage Threshold:** Configurable (default: unlimited)

Keycloak typically does not trigger overage because it can include unlimited groups in custom claims. However, if you configure a groups claim mapper with a size limit, overage can occur.

**Overage Indicator:**
- Custom implementation (no standard indicator)
- Mice checks for empty groups array + directory configured

**Directory API:**
- Endpoint: `GET {admin-url}/admin/realms/{realm}/users/{id}/groups`
- Authentication: Client credentials grant with `manage-users` role

**Configuration:**
```env
DIRECTORY_PROVIDER=keycloak
KEYCLOAK_ADMIN_URL=http://keycloak:8080
KEYCLOAK_REALM=mice
OIDC_ISSUER=http://keycloak:8080/realms/mice
OIDC_CLIENT_ID=mice-web
OIDC_CLIENT_SECRET=your-secret
```

**Keycloak Setup:**
1. Create client (`mice-web`)
2. Enable "Client authentication"
3. Enable "Service accounts roles"
4. Go to "Service account roles" tab
5. Assign `manage-users` role (realm-management)
6. Configure groups claim mapper (if limiting size)

**Testing:**
```bash
# Fetch admin token
curl -X POST "http://keycloak:8080/realms/{realm}/protocol/openid-connect/token" \
  -d "client_id=mice-web" \
  -d "client_secret=your-secret" \
  -d "grant_type=client_credentials"

# Test group fetch
curl "http://keycloak:8080/admin/realms/{realm}/users/{user-id}/groups" \
  -H "Authorization: Bearer {access-token}"
```

### Okta

**Overage Threshold:** ~100 groups (varies by org settings)

**Overage Indicator:**
```json
{
  "iss": "https://{org}.okta.com/oauth2/default",
  "sub": "00u...",
  "email": "alice@example.com",
  "_claim_sources": {
    "groups": {
      "endpoint": "https://{org}.okta.com/oauth2/v1/userinfo"
    }
  }
}
```

**Directory API:**
- Endpoint: `GET https://{org}.okta.com/api/v1/users/{id}/groups`
- Authentication: SSWS API token or OAuth 2.0 token
- Pagination: Use `after` cursor for >200 groups

**Configuration:**
```env
DIRECTORY_PROVIDER=okta  # Future support
OKTA_DOMAIN={org}.okta.com
OKTA_API_TOKEN={ssws-token}
OIDC_ISSUER=https://{org}.okta.com/oauth2/default
OIDC_CLIENT_ID={client-id}
OIDC_CLIENT_SECRET={client-secret}
```

**Status:** ⚠️ Not yet implemented (future work)

### Auth0

**Overage Threshold:** ~1000 groups (varies by plan)

Auth0 typically does not trigger overage because groups are stored in app_metadata and can include large arrays. If overage occurs, use Management API.

**Directory API:**
- Endpoint: `GET https://{domain}/api/v2/users/{id}`
- Response: `app_metadata.groups` or custom field
- Authentication: Management API token

**Configuration:**
```env
DIRECTORY_PROVIDER=auth0  # Future support
AUTH0_DOMAIN={tenant}.auth0.com
AUTH0_MGMT_CLIENT_ID={mgmt-client-id}
AUTH0_MGMT_CLIENT_SECRET={mgmt-secret}
OIDC_ISSUER=https://{tenant}.auth0.com/
OIDC_CLIENT_ID={client-id}
OIDC_CLIENT_SECRET={client-secret}
```

**Status:** ⚠️ Not yet implemented (future work)

## Implementation Details

### Overage Detection

**File:** `auth/src/authentication/oidc/oidcClaims.ts`

```typescript
export function hasGroupOverage(payload: Record<string, unknown>, groupsClaim: string): boolean {
  // Microsoft Entra ID: _claim_names.groups exists
  const claimNames = payload._claim_names
  if (claimNames && typeof claimNames === 'object' && 'groups' in claimNames) {
    return true
  }
  
  // Has groups in claim = not overage
  const groupsValue = payload[groupsClaim]
  if (Array.isArray(groupsValue) && groupsValue.length > 0) {
    return false
  }
  
  // _claim_sources present = likely overage
  if (payload._claim_sources && typeof payload._claim_sources === 'object') {
    return true
  }
  
  return false
}
```

### Directory Integration

**File:** `auth/src/authentication/directory/directoryTypes.ts`

```typescript
export interface Directory {
  readonly configured: boolean
  readonly issuer: string
  searchUsers(q: string, limit: number): Promise<DirectoryUserHit[]>
  searchGroups(q: string, limit: number): Promise<DirectoryGroupHit[]>
  userStatus(sub: string): Promise<DirectoryUserStatus>
  getUserGroups(sub: string): Promise<string[]>  // For overage handling
}
```

### Login Flow Integration

**File:** `auth/src/authentication/oidc/loginFlow.ts`

```typescript
async function finishLogin(...): Promise<LoginResult> {
  // ...
  const user = await provider.completeLogin({ code, codeVerifier, nonce })
  
  // Ticket 18: Resolve group overage by fetching from directory if needed
  if (user.groupsOverage) {
    const resolved = await resolveGroupOverage(user, directory)
    if (!resolved) {
      // Overage detected but directory fetch failed - explicit login failure
      return fail(
        500,
        'Group membership could not be determined. Please contact your administrator.',
        isReauth
      )
    }
  }
  
  // Build SessionUser with groups
  return { ok: true, user: { ...user, groups: user.groups } }
}
```

## Troubleshooting

### "Group membership could not be determined"

**Cause:** IdP returned overage indicator but directory API call failed.

**Common Reasons:**
1. Directory not configured (`DIRECTORY_PROVIDER` not set)
2. Insufficient permissions (missing `GroupMember.Read.All`)
3. Network error (directory API unreachable)
4. Invalid credentials (expired client secret)
5. User doesn't exist in directory (deleted but still in IdP)

**Resolution:**
```bash
# Check directory configuration
echo $DIRECTORY_PROVIDER
echo $KEYCLOAK_ADMIN_URL

# Test directory API manually
curl "https://graph.microsoft.com/v1.0/users/{user-id}/memberOf" \
  -H "Authorization: Bearer {token}"

# Check Mice logs
docker logs mice-auth-1 | grep "overage"
```

### Directory returns empty groups

**Cause:** User exists but has no group memberships, or directory fetch failed silently.

**Common Reasons:**
1. User removed from all groups in directory
2. Directory out of sync with IdP
3. Permissions issue (can read user but not groups)
4. Wrong user ID (subject mismatch)

**Resolution:**
```bash
# Check user groups in directory
az ad user get-member-groups --id alice@example.com

# Check Mice logs for warnings
docker logs mice-auth-1 | grep "directory returned no groups"

# Verify issuer matches
# IdP issuer should match directory issuer
```

### Overage not detected

**Cause:** IdP should return overage indicator but doesn't.

**Common Reasons:**
1. User doesn't actually exceed overage threshold
2. IdP configured to never return overage (always include groups)
3. Groups claim mapper using pagination (Okta)

**Resolution:**
```bash
# Decode id_token to check for overage indicator
echo $ID_TOKEN | cut -d. -f2 | base64 -d | jq

# Look for _claim_names or _claim_sources
```

## Testing

### Unit Tests

**File:** `auth/src/authentication/oidc/groupOverage.test.ts`

```bash
cd auth
npx tsx --test src/authentication/oidc/groupOverage.test.ts
```

12 tests covering:
- Overage detection (Entra indicator, normal claims, no groups)
- Directory fetching (success, unconfigured, fetch failure)
- Resolution workflow (fetch + update, failure handling)

### Integration Tests

**File:** `auth/src/authentication/oidc/loginFlowProvider.test.ts`

```bash
cd auth
npx tsx --test src/authentication/oidc/loginFlowProvider.test.ts
```

6 tests covering:
- Normal login with groups
- Overage detection + successful fetch
- Overage + directory failure (login fails)
- No overage (uses IdP groups)

### Manual Testing with Keycloak

```bash
# 1. Create user with many groups
for i in {1..250}; do
  curl -X POST "http://keycloak:8080/admin/realms/mice/groups" \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -d "{\"name\": \"group-$i\"}"
done

# 2. Add user to all groups
for i in {1..250}; do
  curl -X PUT "http://keycloak:8080/admin/realms/mice/users/$USER_ID/groups/$(get_group_id group-$i)" \
    -H "Authorization: Bearer $ADMIN_TOKEN"
done

# 3. Attempt login and check logs
docker logs mice-auth-1 -f | grep overage
```

## Performance Considerations

### Caching

**Current:** No caching - directory API called on every login with overage.

**Future:** Cache groups for session duration:
- Store groups in session metadata
- Refresh only on explicit re-authentication
- Invalidate on directory sync

### Rate Limiting

Directory API calls are subject to IdP rate limits:
- **Microsoft Graph:** 10,000 requests/10 min per app
- **Keycloak:** Unlimited (self-hosted)
- **Okta:** 1,000 requests/min (varies by plan)

**Mitigation:**
- Users with overage should be infrequent
- Consider caching if many users exceed threshold
- Monitor directory API usage in IdP dashboard

### Latency

Directory API adds latency to login:
- **Microsoft Graph:** ~200-500ms
- **Keycloak:** ~50-150ms (local network)
- **Okta:** ~100-300ms

**Acceptable:** Login already includes IdP round-trip (~500ms), so directory fetch adds <100% overhead.

## Security

### Fail-Closed Philosophy

When group overage is detected:
1. ✅ **Both IdP and directory must succeed** for login
2. ✅ **Explicit error** when directory fetch fails
3. ✅ **No fallback** to empty groups or cached data
4. ✅ **Logged** for observability and audit

This prevents users from logging in with incomplete authorization data.

### API Permissions

Directory API requires elevated permissions:
- **Microsoft Graph:** `GroupMember.Read.All` (application permission)
- **Keycloak:** `manage-users` role
- **Okta:** Read-only API token

**Principle:** Least privilege - only read access, no write/delete.

### Audit Trail

All overage events are logged:
```
[mice-auth] Fetched 237 groups from directory for user alice@example.com (overage recovery)
[mice-auth] Group overage detected but directory not configured. Login will fail.
[mice-auth] Group overage for user bob@example.com but directory returned no groups.
```

## References

- **Specification:** `respec/01-authentication/spec.md` (Round 8 U17)
- **Ticket:** `.scratch/authentication/issues/18-group-overage-handling.md`
- **RFC:** No RFC - IdP-specific behavior
- **Microsoft Docs:** [Handle overage in tokens](https://docs.microsoft.com/en-us/azure/active-directory/develop/id-tokens#groups-overage-claim)
- **Okta Docs:** [Groups claim](https://developer.okta.com/docs/guides/customize-tokens-groups-claim/main/)
- **Keycloak Docs:** [Group mappers](https://www.keycloak.org/docs/latest/server_admin/index.html#_group-mappers)
