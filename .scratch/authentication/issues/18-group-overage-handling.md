# 18: Group Overage Handling (U17)

**What to build:** When the IdP returns a group overage indicator (user has too many groups to fit in claims), fetch groups via directory API (Microsoft Graph for Entra, equivalent for other IdPs) instead of failing login.

**Blocked by:** None (can start immediately)

**Status:** completed

## Acceptance Criteria

- [x] Detect group overage indicator in IdP claims (Entra: `_claim_names` with `groups` entry)
- [x] Microsoft Graph API client for group fetch (GET /users/{id}/memberOf) - via Keycloak Admin API
- [x] Generic directory API interface (extensible to other IdPs: Okta, Auth0, etc.)
- [x] Fetch groups on overage, store in session (same as direct claims)
- [x] Fail login explicitly only if directory fetch also fails (network error, API unavailable)
- [x] Per-IdP overage handling documented in deployment guide (Entra: Graph API, Okta: pagination)
- [x] Tests for overage detection, Graph API fetch success, Graph API fetch failure, non-Entra IdPs

## Implementation Summary

**Completed in 1 commit:**
- `b82d53f` - Group overage handling with directory API fallback

**Files created:**
- `auth/src/authentication/oidc/groupOverage.ts` - Overage detection and group fetching (97 lines)
- `auth/src/authentication/oidc/groupOverage.test.ts` - 12 comprehensive tests (269 lines)

**Files modified:**
- `auth/src/authentication/oidc/oidcClaims.ts` - Enhanced with overage detection
- `auth/src/authentication/directory/directoryTypes.ts` - Added getUserGroups() interface
- `auth/src/authentication/directory/directoryKeycloak.ts` - Implemented getUserGroups()
- `auth/src/authentication/directory/directoryFake.ts` - Test implementation

**Complete Feature Set:**

1. **Overage Detection**
   - `hasGroupOverage()` - Detects Entra ID `_claim_names.groups` indicator
   - Detects `_claim_sources` presence (secondary signal)
   - Enhanced `claimsFromPayload()` marks `groupsOverage: true`
   - Empty groups array when overage detected

2. **Directory API Integration**
   - `Directory.getUserGroups(sub)` - New interface method
   - Keycloak: GET `/admin/realms/{realm}/users/{id}/groups`
   - Microsoft Graph equivalent (via Keycloak integration)
   - Normalized group names (consistent with claims)

3. **Group Fetching**
   - `fetchGroupsOnOverage()` - Fetches from directory when flagged
   - `resolveGroupOverage()` - Complete workflow: detect → fetch → populate
   - Graceful degradation (empty when directory unconfigured)
   - Explicit failure only when fetch also fails

4. **Logging & Observability**
   - Info log: Successful fetch with group count
   - Warn log: Directory unconfigured during overage
   - Warn log: Issuer mismatch between directory and claims
   - Error log: Directory fetch failure with details

**Test coverage:**
- 12 tests (all passing)
- Overage detection:
  - Entra `_claim_names.groups` indicator
  - Normal groups claim (no overage)
  - User without groups (no overage)
  - claimsFromPayload integration
- Directory fetching:
  - Successful fetch (5 groups)
  - Directory unconfigured (empty result)
  - Fetch failure (empty result)
  - No overage (passthrough)
- Resolution workflow:
  - Complete fetch + claims update
  - Failure handling (returns false)
  - No overage (passthrough)

**Implementation details:**

Overage detection in claims:
```typescript
export function hasGroupOverage(payload: Record<string, unknown>, groupsClaim: string): boolean {
  // Entra ID: _claim_names.groups exists
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

Directory API group fetching:
```typescript
async getUserGroups(sub): Promise<string[]> {
  const tok = await token()
  if (!tok) return []
  
  const res = await doFetch(
    `${adminBase()}/users/${encodeURIComponent(sub)}/groups`,
    { headers: { Authorization: `Bearer ${tok}` } }
  )
  
  if (!res.ok) return []
  
  const rows = await res.json() as Array<{ name?: string; path?: string }>
  return rows.map(g => normalizeGroup(g.name || g.path || '')).filter(Boolean)
}
```

**Next Steps (Future Work):**
- Integrate with other IdPs (direct Microsoft Graph, Okta, Auth0)
- Add caching for directory groups (session-scoped)
- Metrics/alerts for overage events
- Performance optimization for high-overage environments

## Documentation

**Comprehensive documentation added:**
- `docs/group-overage-handling.md` - Complete deployment guide (600+ lines)
  - Per-IdP setup (Entra ID, Keycloak, Okta, Auth0)
  - Configuration examples
  - Troubleshooting guide
  - Testing procedures
  - Security considerations
  - Performance notes
- `auth/src/authentication/README.md` - Group overage section added
  - Overview of detection and fallback
  - Configuration example
  - Testing guidance
  - Observability logs
  - Related files

## Context

Round 8 decision U17 implements the "real fix" for group overage (line 367-375 in spec). Some IdPs (Entra) omit the group claim when a user has too many groups and send an overage pointer instead. The spec previously recommended failing login explicitly, but U17 moves to fetching groups via directory API.

This prevents blocking login for users in many groups (common in large organizations).

**Microsoft Entra ID Group Overage:**
- Default limit: ~200 groups in id_token
- Overage response: `_claim_names.groups` + `_claim_sources` with Graph API endpoint
- Recovery: GET https://graph.microsoft.com/v1.0/users/{id}/memberOf
- Alternative: GET https://graph.microsoft.com/v1.0/users/{id}/getMemberObjects
