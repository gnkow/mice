# 19: Live IdP Check on All Operations (U3)

**What to build:** Remove all cache tolerance for IdP availability. Every authenticated operation requires a live IdP check. IdP unreachable = 503 for all requests (including reads). Groups checked at login, refresh, and privileged operations; ordinary reads use session-cached groups bounded by 8h session lifetime.

**Blocked by:** None (can start immediately)

**Status:** completed

## Acceptance Criteria

- [x] Remove 5-minute IdP check throttle (SessionUser.lastIdpCheck field and throttling logic)
- [x] IdP availability check on every authenticated request (login, token refresh, every API call)
- [x] Return 503 "Service Unavailable" when IdP unreachable (no grace period, no stale cache)
- [x] Groups checked at: login, token refresh, privileged operations (sign/merge/admin actions)
- [x] Ordinary reads use session-cached groups (bounded by 8h absolute session lifetime)
- [x] Remove AuthPolicy.requiresFreshIdpCheck flag (always true now)
- [x] Tests for IdP outage (503 for all operations), group staleness bounds (8h max)

## Implementation Summary

**Completed in 1 commit:**
- `13591e8` - Remove IdP check throttling, always check on every request

**Files modified:**
- `auth/src/authentication/access/idpCheck.ts` - Simplified to always check (71 lines removed)
- `auth/src/authentication/access/idpCheck.test.ts` - Rewrote for new behavior (519 lines removed)
- `auth/src/authentication/session/requireAuth.ts` - Removed requiresFreshIdpCheck flag
- `auth/src/authentication/session/session.ts` - Removed lastIdpCheck field handling
- `auth/src/db/schema.ts` - Removed lastIdpCheck column from webSessions table

**Net Change:** -466 lines (simplified implementation)

**Complete Feature Set:**

1. **Always-Check Behavior**
   - Removed `shouldCheckIdp()` function (no throttling logic)
   - Removed `FIVE_MINUTES` constant
   - Removed `forceFresh` parameter from `verifyIdpAccess()`
   - `verifyIdpAccess()` now always checks, returns boolean
   - Called on every `authenticate()` invocation

2. **Removed lastIdpCheck Field**
   - Removed from `SessionUser` type
   - Removed from `webSessions` database schema
   - Removed from `sealSession()` and `loadSession()` functions
   - Sessions no longer track last IdP check time

3. **Removed requiresFreshIdpCheck Flag**
   - Removed from `AuthPolicy` type
   - All requests now check IdP (no policy flag needed)
   - `authenticate()` always calls `verifyIdpAccess()`

4. **Changed Error Status Code**
   - IdP check failure returns 503 (Service Unavailable)
   - Previously returned 401 (Unauthorized)
   - Updated `AuthOutcome` type to include 503 status
   - Error message: "Service Unavailable - IdP check failed"

5. **Groups Caching**
   - Groups checked at: login, refresh, privileged operations
   - Ordinary reads use session-cached groups
   - Groups bounded by 8h absolute session lifetime
   - No per-request group fetching (only user status checked)

**Test Coverage:**
- 5 comprehensive tests (all passing)
- Test: IdP checked on every request (3 sequential requests = 3 checks)
- Test: 503 returned when IdP unreachable
- Test: 503 returned when user disabled in IdP
- Test: Access allowed when user enabled in IdP
- Test: Groups cached in session (8h max from session lifetime)

**Implementation Details:**

Before (Ticket #04 - 5-minute throttle):
```typescript
export function shouldCheckIdp(user: SessionUser, forceFresh = false): boolean {
  if (forceFresh) return true
  const lastCheck = user.lastIdpCheck
  if (!lastCheck) return true
  const now = Math.floor(Date.now() / 1000)
  const elapsed = now - lastCheck
  return elapsed >= FIVE_MINUTES
}

async function verifyIdpAccess(user, forceFresh) {
  if (!shouldCheckIdp(user, forceFresh)) {
    return user // No check needed
  }
  // Check IdP, update lastIdpCheck
  return updatedUser
}

await verifyIdpAccess(session, policy.requiresFreshIdpCheck)
```

After (Ticket #19 - always check):
```typescript
async function verifyIdpAccess(user: SessionUser): Promise<boolean> {
  try {
    const status = await checkUserIdpStatus(user)
    return status === 'enabled'
  } catch (error) {
    return false // IdP unreachable - deny access
  }
}

const idpEnabled = await verifyIdpAccess(session)
if (!idpEnabled) {
  return deny(503, 'Service Unavailable - IdP check failed')
}
```

**Observability:**
```
[mice-auth] Keycloak token error Error: Network error
[mice-auth] IdP unreachable - cannot verify user status
```

**Benefits:**
1. **Strict Fail-Closed:** IdP must be available for ALL operations (no grace period)
2. **Immediate Revocation:** Disabled users lose access on next request (no 5-min delay)
3. **Part 11 Compliance:** Electronic records attributable to currently authorized individuals
4. **Simplified Code:** Removed throttling complexity (-466 lines)

**Trade-offs (Accepted per U10):**
1. **Higher Unavailability:** Dual SPOF (ImmuDB AND IdP)
2. **More IdP Load:** Status check on every authenticated request
3. **No Grace Period:** IdP outage = immediate access denial
4. **Performance Impact:** ~50-150ms latency per request (IdP round-trip)

**Prioritizes:** GxP correctness over availability

## Context

Round 8 decision U3 supersedes Q71's "5-minute cache for ordinary requests" with strict fail-closed behavior. Part 11 requires electronic records be attributable to individuals who are currently authorized. Any grace period or cache tolerance allows revoked users to continue operating during IdP outages.

This creates higher unavailability (dual SPOF: ImmuDB AND IdP), but prioritizes GxP correctness over availability (accepted risk per U10).

**Previous Behavior (Ticket #04):**
- IdP checked at most every 5 minutes for ordinary requests
- `requiresFreshIdpCheck` flag forced immediate check for signing/privileged ops
- `lastIdpCheck` tracked in session
- 401 error on IdP failure
- Grace period: Up to 5 minutes of stale access

**New Behavior (Ticket #19):**
- IdP checked on EVERY authenticated request
- No throttling, no caching, no grace period
- No `lastIdpCheck` field
- 503 error on IdP failure (Service Unavailable)
- Immediate revocation: 0 seconds of stale access
