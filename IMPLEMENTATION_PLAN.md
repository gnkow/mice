# Authentication Tickets 04-13: TDD Implementation Plan

## Status Summary

**Ticket 01-03**: ✅ Complete and merged to `auth-implementation`
**Ticket 04**: 🟡 In progress (1/20 tests passing, foundation laid)
**Tickets 05-13**: ⏳ Ready for implementation

## Current State (Ticket 04)

### Completed
- ✅ Test infrastructure set up
- ✅ Database connection working
- ✅ First vertical slice passing: IdP unreachable check returns 'error' status
- ✅ RED commit created with all 20 failing tests
- ✅ First GREEN commit with one test passing

### Remaining Work for Ticket 04

#### 1. IdP Check Integration (5 tests)
**Files to modify:**
- `auth/src/authentication/session/session.ts` - Add `lastIdpCheck` timestamp to SessionUser
- `auth/src/authentication/session/requireAuth.ts` - Add IdP check before granting access
- `auth/src/db/schema.ts` - Add `lastIdpCheck` column to `web_sessions` table

**TDD Approach:**
```typescript
// RED: Write failing test
it('denies access when last IdP check is older than 5 minutes', async () => {
  // Create session with old lastIdpCheck
  // Attempt authentication
  // Expect: denial with IdP check required
})

// GREEN: Implement minimum code to pass
export async function authenticate(c: Context, policy: AuthPolicy = {}): Promise<AuthOutcome> {
  const session = await getSession(c)
  if (session) {
    const now = Math.floor(Date.now() / 1000)
    const lastCheck = session.lastIdpCheck ?? 0
    if (now - lastCheck > 300) { // 5 minutes
      const status = await lookupKeycloakUserStatus(session.sub)
      if (status !== 'enabled') {
        return deny(401, 'Access denied: IdP check failed')
      }
      // Update lastIdpCheck
      await updateSessionIdpCheck(sessionId, now)
    }
    // ... existing authentication logic
  }
}

// REFACTOR: Extract to helper, add tests for edge cases
```

#### 2. Disabled Principal Handling (6 tests)
**New files to create:**
- `auth/src/authentication/access/idpCheck.ts` - Core IdP checking logic
- `auth/src/authentication/access/idpCheck.test.ts` - Already created with 20 tests

**Key functions needed:**
```typescript
export async function checkIdpStatus(
  principal: PrincipalId,
  context: 'login' | 'refresh' | 'signing' | 'mutation' | 'request'
): Promise<{ allowed: boolean; reason?: string }> {
  const status = await lookupKeycloakUserStatus(principal.sub)
  
  if (status === 'error') {
    // IdP unreachable - deny access (no cache)
    return { allowed: false, reason: 'IdP unavailable' }
  }
  
  if (status === 'disabled' || status === 'missing') {
    // User disabled or deleted in IdP
    return { allowed: false, reason: 'Principal disabled in IdP' }
  }
  
  return { allowed: true }
}

// Throttle checks for ordinary requests (5 minute window)
export function shouldCheckIdp(
  lastCheck: number | null,
  context: 'login' | 'refresh' | 'signing' | 'mutation' | 'request'
): boolean {
  if (['login', 'refresh', 'signing', 'mutation'].includes(context)) {
    return true // Always check for critical operations
  }
  
  // For ordinary requests, check at most every 5 minutes
  const now = Math.floor(Date.now() / 1000)
  return !lastCheck || (now - lastCheck > 300)
}
```

#### 3. Re-enable and Restoration Logic (3 tests)
**Files to modify:**
- `auth/src/authentication/access/principalStatus.ts` - New file for status tracking
- `auth/src/db/schema.ts` - Add `disabledAt`, `disabledReason`, `miceFlags` to principals

**Database schema additions:**
```typescript
export const principals = pgTable('principals', {
  // ... existing fields
  disabledAt: ts('disabled_at'),
  disabledReason: text('disabled_reason'),
  miceFlags: jsonb('mice_flags').$type<string[]>().default([]),
})
```

**Implementation logic:**
```typescript
export async function handleReEnable(principal: PrincipalId): Promise<{ok: boolean; reason?: string}> {
  const record = await getPrincipalRecord(principal)
  
  if (!record.disabledAt) {
    return { ok: true } // Never disabled
  }
  
  const daysSinceDisabled = (Date.now() - record.disabledAt.getTime()) / (1000 * 60 * 60 * 24)
  
  // Check Mice flags
  if (record.miceFlags.length > 0) {
    return { ok: false, reason: 'Mice flags must be explicitly lifted' }
  }
  
  // Auto-restore within 30 days
  if (daysSinceDisabled <= 30) {
    await auditRestore(principal, 'automatic')
    await clearDisabledStatus(principal)
    return { ok: true }
  }
  
  // Requires admin confirmation after 30 days
  return { ok: false, reason: 'Requires admin re-confirmation' }
}
```

#### 4. Mice Flags (2 tests)
**Implementation:**
```typescript
export type MiceFlag = 'security_hold' | 'compliance_review' | 'admin_suspend'

export async function suspendPrincipal(
  principal: PrincipalId,
  flag: MiceFlag,
  reason: string
): Promise<void> {
  // Add flag without deleting grants
  await getDb()
    .update(principals)
    .set({ 
      miceFlags: sql`array_append(${principals.miceFlags}, ${flag})`,
      disabledAt: new Date(),
      disabledReason: reason
    })
    .where(eq(principals.iss, principal.iss))
    .where(eq(principals.sub, principal.sub))
    
  // Grants are preserved, access is suspended
}

export async function liftMiceFlag(
  principal: PrincipalId,
  flag: MiceFlag,
  admin: PrincipalId
): Promise<void> {
  // Explicit admin action required
  await auditFlagLift(principal, flag, admin)
  await getDb()
    .update(principals)
    .set({ 
      miceFlags: sql`array_remove(${principals.miceFlags}, ${flag})`
    })
    // ... where clause
}
```

#### 5. Bootstrap Rules (2 tests)
**Files to modify:**
- `auth/src/authentication/directory/groupBootstrap.ts` - Limit to read-only

**Implementation:**
```typescript
// In groupBootstrap.ts
const MAX_BOOTSTRAP_ROLE = 'read' // Enforced limit

export function validateBootstrapGrants(grants: unknown[]): {ok: boolean; reason?: string} {
  for (const grant of grants) {
    if (grant.role && !['read', 'triage'].includes(grant.role)) {
      return { ok: false, reason: 'Bootstrap rules limited to read-only baseline' }
    }
  }
  return { ok: true }
}
```

#### 6. iss+sub Reuse Detection (3 tests)
**New file:**
- `auth/src/authentication/access/identityReuse.ts`

**Implementation:**
```typescript
export const principals = pgTable('principals', {
  // ... existing
  nameHistory: jsonb('name_history').$type<{name: string; at: Date}[]>().default([]),
})

export async function detectIdentityReuse(
  identity: PrincipalId & { name: string }
): Promise<{safe: boolean; incident?: string}> {
  const existing = await getPrincipalRecord(identity)
  
  if (!existing) {
    return { safe: true } // New principal
  }
  
  // Check if name differs significantly (indicating different person)
  const nameChanged = existing.nameHistory.some(h => 
    !namesMatch(h.name, identity.name)
  )
  
  if (nameChanged) {
    // iss+sub reissued to different person
    const incident = await raiseSecurityIncident({
      type: 'identity_reuse',
      principal: identity,
      previousNames: existing.nameHistory.map(h => h.name),
      newName: identity.name
    })
    return { safe: false, incident: incident.id }
  }
  
  // Check rehire logic (spec S8)
  if (existing.disabledAt) {
    const monthsSinceDisabled = 
      (Date.now() - existing.disabledAt.getTime()) / (1000 * 60 * 60 * 24 * 30)
    
    if (monthsSinceDisabled > 12) {
      // Treat as rehire - requires fresh onboarding
      await markAsRehire(identity)
    }
  }
  
  return { safe: true }
}
```

#### 7. Group Matching by Object ID (1 test)
**Files to modify:**
- `auth/src/authentication/directory/directoryKeycloak.ts`
- `auth/src/authentication/directory/directoryTypes.ts`

**Schema change:**
```typescript
export type DirectoryGroupHit = {
  kind: 'group'
  group: string
  name: string
  objectId: string // Add this field
}
```

## Ticket 05: Authentication Event Audit and Alerts

### Dependencies
- Blocked by: Tickets 03, 04

### Implementation Overview

**New files to create:**
- `auth/src/authentication/audit/authEvents.ts` - Authentication event types
- `auth/src/authentication/audit/authEvents.test.ts` - TDD tests
- `auth/src/authentication/audit/failureAlerts.ts` - Alert logic for repeated failures
- `auth/src/authentication/audit/redaction.test.ts` - Test that secrets don't reach logs

**Key features:**
1. **Audit Events** (9 test cases)
   - Login, refresh, logout, step-up, failure, revocation
   - Include request ID and Principal
   - NEVER include IPs, tokens, cookies, or codes
   - Inspector query by Principal and month

2. **Constant-Time Errors** (3 test cases)
   - All authentication failures return identical responses
   - Timing is uniform (no timing attacks)
   - No information leakage

3. **Failure Alerts** (4 test cases)
   - Track failures per Principal
   - Alert security admins after 5 failures in 10 minutes
   - Clear counter after successful auth

**Implementation sketch:**
```typescript
// auth/src/authentication/audit/authEvents.ts
export type AuthEventType = 
  | 'login' 
  | 'refresh' 
  | 'logout' 
  | 'step_up' 
  | 'failure' 
  | 'revocation'

export async function auditAuthEvent(
  type: AuthEventType,
  principal: PrincipalId,
  requestId: string,
  details?: Record<string, unknown>
): Promise<void> {
  // Ensure no secrets in details
  const sanitized = redactSecrets(details)
  
  await appendAudit({
    event: 'auth.' + type,
    principal: principalKey(principal),
    requestId,
    details: sanitized,
    // NEVER include: ip, token, cookie, code
  })
  
  if (type === 'failure') {
    await checkFailureThreshold(principal)
  }
}

const FAILURE_WINDOW_MS = 10 * 60 * 1000 // 10 minutes
const FAILURE_THRESHOLD = 5

async function checkFailureThreshold(principal: PrincipalId): Promise<void> {
  const recentFailures = await countRecentAuthEvents(
    principal,
    'failure',
    FAILURE_WINDOW_MS
  )
  
  if (recentFailures >= FAILURE_THRESHOLD) {
    await alertSecurityAdmins({
      type: 'repeated_auth_failures',
      principal: principalKey(principal),
      count: recentFailures,
      windowMs: FAILURE_WINDOW_MS
    })
  }
}
```

**Database additions:**
```sql
CREATE INDEX auth_events_principal_time 
ON audit_log(principal, timestamp) 
WHERE event LIKE 'auth.%';
```

## Ticket 06: Revocation and Suspension

### Dependencies
- Blocked by: Ticket 05

### Implementation Overview

**Files to modify:**
- `auth/src/authentication/credentials/credentialRevocation.ts` - Extend revocation logic
- `auth/src/authentication/access/suspension.ts` - New file for suspension
- `auth/src/authentication/oidc/backChannelLogout.ts` - Validate back-channel logout

**Key features:**
1. **ACCESS_REVOKED Error** (2 tests)
   - Check revocation status on every request
   - No revocation cache
   - Return 503 if audit Intent cannot be appended

2. **Admin Revoke-All** (3 tests)
   - Revoke all credentials for a Principal
   - End all Sessions and CLI credentials
   - Requires audit log success

3. **Second-Admin Confirmation** (4 tests)
   - Security-role suspend requires second admin within 24h
   - Unconfirmed suspend lapses
   - Both admins recorded in audit

4. **Role/Grant Changes Force Re-auth** (2 tests)
   - Any privilege change ends current Sessions
   - Forces fresh login to pick up new permissions

5. **Back-Channel Logout Validation** (5 tests)
   - Validate signature
   - Check issuer and audience
   - Verify event type
   - Reject JTI replay
   - Handle nonce correctly

**Implementation:**
```typescript
// auth/src/authentication/access/suspension.ts
export type SuspensionRequest = {
  principal: PrincipalId
  requestedBy: PrincipalId
  reason: string
  expiresAt: Date
}

export async function initiateSuspension(
  req: SuspensionRequest
): Promise<{ok: boolean; suspensionId?: string}> {
  // Record Intent in audit
  const intentOk = await appendAuditIntent({
    action: 'principal.suspend',
    principal: principalKey(req.principal),
    requestedBy: principalKey(req.requestedBy),
    reason: req.reason
  })
  
  if (!intentOk) {
    // MUST NOT proceed if audit fails
    return { ok: false }
  }
  
  const suspensionId = randomUUID()
  await getDb().insert(pendingSuspensions).values({
    id: suspensionId,
    principalKey: principalKey(req.principal),
    requestedBy: principalKey(req.requestedBy),
    reason: req.reason,
    createdAt: new Date(),
    expiresAt: req.expiresAt,
    status: 'pending_confirmation'
  })
  
  return { ok: true, suspensionId }
}

export async function confirmSuspension(
  suspensionId: string,
  confirmedBy: PrincipalId
): Promise<{ok: boolean; reason?: string}> {
  const pending = await getPendingSuspension(suspensionId)
  
  if (!pending) {
    return { ok: false, reason: 'Suspension not found' }
  }
  
  // Check 24h window
  if (Date.now() > pending.expiresAt.getTime()) {
    await lapseSuspension(suspensionId)
    return { ok: false, reason: 'Confirmation window expired' }
  }
  
  // Ensure different admin
  if (pending.requestedBy === principalKey(confirmedBy)) {
    return { ok: false, reason: 'Cannot self-confirm suspension' }
  }
  
  // Audit confirmation
  const intentOk = await appendAuditIntent({
    action: 'principal.suspend.confirm',
    suspensionId,
    confirmedBy: principalKey(confirmedBy)
  })
  
  if (!intentOk) {
    return { ok: false, reason: 'Audit append failed' }
  }
  
  // Execute suspension
  await revokePrincipalCredentials(parsePrincipalKey(pending.principalKey))
  await markSuspensionConfirmed(suspensionId)
  
  return { ok: true }
}
```

## Ticket 07: CLI Device Login

### Dependencies
- Blocked by: Tickets 04, 05

### Implementation Overview

**New files:**
- `auth/src/authentication/device/deviceFlow.ts` - RFC 8628 implementation
- `auth/src/authentication/device/deviceFlow.test.ts` - TDD tests
- `auth/src/authentication/device/keychain.ts` - OS keychain integration

**Key features:**
1. **Device Flow** (6 tests)
   - User code with sufficient entropy
   - Rate limits
   - Expiry handling
   - Single use
   - 8h access token
   - Rotating refresh with reuse detection

2. **Keychain Management** (4 tests)
   - Store per Principal
   - Refuse second Principal on same OS user
   - Acting-as banner when multiple exist
   - Write confirmation

3. **Credential Lifecycle** (3 tests)
   - Logout ends CLI and web credentials
   - Desktop Sessions suspend then resume
   - Credential never outlives IdP status

**Implementation sketch:**
```typescript
// auth/src/authentication/device/deviceFlow.ts
export async function initiateDeviceFlow(
  scopes?: PatScope[]
): Promise<{
  device_code: string
  user_code: string
  verification_uri: string
  expires_in: number
}> {
  // Generate user code with sufficient entropy (8 chars, alphanumeric)
  const userCode = generateUserCode() // e.g., "ABCD-1234"
  const deviceCode = randomBytes(32).toString('base64url')
  
  await getDb().insert(deviceAuthorizations).values({
    deviceCodeHash: hashId(deviceCode),
    userCode,
    status: 'pending',
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 min
    scopes: scopes ?? null
  })
  
  return {
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: `${env.publicWebOrigin}/device`,
    expires_in: 900
  }
}

export async function pollDeviceAuthorization(
  deviceCode: string
): Promise<{
  ok: boolean
  access_token?: string
  refresh_token?: string
  error?: string
}> {
  const auth = await getDeviceAuthorization(deviceCode)
  
  if (!auth || Date.now() > auth.expiresAt.getTime()) {
    return { ok: false, error: 'expired_token' }
  }
  
  if (auth.status === 'pending') {
    return { ok: false, error: 'authorization_pending' }
  }
  
  if (auth.status === 'denied') {
    return { ok: false, error: 'access_denied' }
  }
  
  // Status is 'approved'
  // Issue tokens with IdP recheck
  const idpStatus = await lookupKeycloakUserStatus(auth.principalSub!)
  if (idpStatus !== 'enabled') {
    return { ok: false, error: 'access_denied' }
  }
  
  const { accessToken, refreshToken } = await issueDeviceTokens({
    sub: auth.principalSub!,
    iss: auth.principalIss!,
    scopes: auth.scopes
  })
  
  // Mark as used (single use)
  await markDeviceAuthUsed(deviceCode)
  
  return { ok: true, access_token: accessToken, refresh_token: refreshToken }
}
```

## Ticket 08: Commit Identity and Job Tokens

### Dependencies
- Blocked by: Tickets 04, 05

### Implementation Overview

**Files to modify:**
- `auth/src/proxyAuthor.ts` - Extend commit author injection
- `auth/src/jobs.ts` - Add Job token generation
- `auth/src/authentication/credentials/jobTokens.ts` - New file

**Key features:**
1. **Trailer Stripping** (2 tests)
   - Client-forged identity trailers removed
   - BFF appends canonical iss+sub

2. **Name Snapshot** (3 tests)
   - Name captured at commit time
   - Name history maintained
   - Audit record matches commit

3. **Job Tokens** (4 tests)
   - Lifetime equals Job maximum runtime
   - Submitter re-checked against IdP at commit
   - IdP down holds commit in finalizing state
   - Never auto-approved

4. **Jobs Cannot Sign** (2 tests)
   - Job tokens lack signing capability
   - Explicit check prevents Jobs from signing

## Ticket 09: Signing Ceremony

### Dependencies
- Blocked by: Tickets 04, 05

### Implementation Overview

**New files:**
- `auth/src/authentication/signing/ceremony.ts` - Part 11 compliant signing
- `auth/src/authentication/signing/ceremony.test.ts` - TDD tests

**Key features:**
1. **Fresh Authentication** (3 tests)
   - Require re-auth within 60s
   - Step-up window is single-use
   - MFA evidence required

2. **Record Hash Binding** (3 tests)
   - Display exact record before signing
   - Hash bound to signature
   - Changed record invalidates signature

3. **Signature Storage** (4 tests)
   - IdP authentication evidence (auth time, method, strength, session ID, token ID)
   - Meaning (Authored/Reviewed/Approved)
   - Server timestamp
   - Record hash

4. **Bulk Approval** (3 tests)
   - One ceremony for multiple records (cap 50)
   - One signature record per item
   - Shared ceremony ID

5. **Self-Signing Prevention** (2 tests)
   - Cannot sign own submission
   - Cannot sign own Job output
   - Refusals audited
   - No admin override

**Implementation:**
```typescript
// auth/src/authentication/signing/ceremony.ts
export type SigningMeaning = 'authored' | 'reviewed' | 'approved'

export type SignatureRecord = {
  id: string
  principalKey: string
  recordId: string
  recordHash: string
  meaning: SigningMeaning
  ceremonyId: string
  authTime: number
  authMethod: string
  authStrength: string // MFA level
  idpSessionId: string
  tokenId: string
  serverTime: Date
  esignDeclarationAccepted: boolean
}

export async function initiateSigning(
  records: string[], // Up to 50
  meaning: SigningMeaning,
  principal: PrincipalId
): Promise<{ok: boolean; ceremonyId?: string; error?: string}> {
  if (records.length > 50) {
    return { ok: false, error: 'Maximum 50 records per ceremony' }
  }
  
  // Check: principal cannot sign own submissions
  for (const recordId of records) {
    const record = await getRecord(recordId)
    if (record.submittedBy === principalKey(principal)) {
      await auditRefusal({
        action: 'sign.refused.self',
        principal: principalKey(principal),
        recordId
      })
      return { ok: false, error: 'Cannot sign own submission' }
    }
  }
  
  const ceremonyId = randomUUID()
  
  // Require fresh authentication
  const stepUp = await requireStepUp(principal, {
    requireMFA: true,
    maxAge: 60,
    purpose: `sign_${meaning}`,
    ceremonyId
  })
  
  if (!stepUp.ok) {
    return { ok: false, error: 'Fresh authentication required' }
  }
  
  return { ok: true, ceremonyId }
}

export async function completeSigningCeremony(
  ceremonyId: string,
  recordContents: Map<string, unknown>, // recordId -> content
  principal: PrincipalId,
  idToken: string
): Promise<{ok: boolean; signatures?: SignatureRecord[]}> {
  const ceremony = await getCeremony(ceremonyId)
  
  // Verify step-up window not reused
  if (ceremony.used) {
    return { ok: false }
  }
  
  // Parse and validate ID token for auth evidence
  const claims = await validateIdToken(idToken)
  
  // Verify MFA
  if (!claims.amr?.includes('mfa')) {
    return { ok: false }
  }
  
  const signatures: SignatureRecord[] = []
  const now = new Date()
  
  for (const [recordId, content] of recordContents) {
    // Compute hash
    const hash = createHash('sha256')
      .update(JSON.stringify(content))
      .digest('hex')
    
    const signature: SignatureRecord = {
      id: randomUUID(),
      principalKey: principalKey(principal),
      recordId,
      recordHash: hash,
      meaning: ceremony.meaning,
      ceremonyId,
      authTime: claims.auth_time,
      authMethod: claims.amr.join(','),
      authStrength: claims.acr ?? 'unknown',
      idpSessionId: claims.sid,
      tokenId: claims.jti,
      serverTime: now, // Server clock only
      esignDeclarationAccepted: ceremony.declarationAccepted
    }
    
    await storeSignature(signature)
    signatures.push(signature)
  }
  
  await markCeremonyUsed(ceremonyId)
  
  return { ok: true, signatures }
}
```

## Ticket 10: Auditor Access

### Dependencies
- Blocked by: Tickets 06, 09

### Implementation Overview

**Files to modify:**
- `auth/src/authz.ts` - Add Auditor role handling
- `auth/src/authentication/access/auditorAccess.ts` - New file
- `auth/src/authentication/access/auditorAccess.test.ts` - TDD tests

**Key features:**
1. **Expiry Enforcement** (2 tests)
   - Admin-set expiry respected even if IdP account active
   - No automatic extension

2. **Read-Only Access** (3 tests)
   - No write capability
   - No sign capability
   - Enforced at authorization layer

3. **Read Auditing** (2 tests)
   - Every read audited with Principal
   - Audit includes resource accessed

4. **No Support Access** (2 tests)
   - No impersonation exists
   - No cross-user support access

5. **Bootstrap Restriction** (1 test)
   - Bootstrap rules cannot grant Auditor

## Ticket 11: IdP Baseline and Drift Reports

### Dependencies
- Blocked by: Tickets 04, 05

### Implementation Overview

**New files:**
- `auth/src/authentication/compliance/idpBaseline.ts` - Baseline checks
- `auth/src/authentication/compliance/driftReport.ts` - Daily drift report

**Key features:**
1. **Baseline Check** (3 tests)
   - MFA enabled
   - Lockout policy configured
   - Password policy meets requirements
   - Run at deploy and daily

2. **Drift Report** (3 tests)
   - Compare IdP vs Mice access state
   - List all discrepancies
   - Stored as validation evidence

3. **Alarm for Disabled+Sign** (2 tests)
   - Alert when disabled Principal has sign rights
   - Immediate notification to security admins

4. **Outage Incident** (2 tests)
   - IdP outage creates incident record
   - Reference manual procedure

## Ticket 12: Access Review and Recovery

### Dependencies
- Blocked by: Tickets 06, 09

### Implementation Overview

**New files:**
- `auth/src/authentication/compliance/accessReview.ts` - Quarterly review
- `auth/src/authentication/access/recovery.ts` - Two-person recovery

**Key features:**
1. **Quarterly Report** (4 tests)
   - List all Principals, roles, grants, last login
   - Electronic signature through signing ceremony
   - Alert if unreviewed after 14 days
   - Audit trail

2. **Two-Person Recovery** (5 tests)
   - Requires two distinct admins
   - Issues 1h single-use recovery token
   - All steps audited
   - Fails with 503 if audit Intent cannot be appended

## Ticket 13: Validation Pack and Clock Alert

### Dependencies
- Blocked by: Tickets 07, 08, 10, 11, 12

### Implementation Overview

**New files:**
- `docs/validation/requirements-traceability.md` - Requirement to test mapping
- `docs/validation/risk-assessment.md` - Risk analysis
- `docs/validation/iq-oq-evidence.md` - Installation and Operation Qualification
- `auth/src/system/clockDrift.ts` - NTP drift monitoring

**Key features:**
1. **Traceability** (2 tests)
   - Every auth requirement maps to ≥1 automated test
   - Matrix shows coverage

2. **Validation Pack** (2 tests)
   - Risk assessment included
   - IQ/OQ evidence included

3. **Revalidation Triggers** (2 tests)
   - IdP baseline change triggers revalidation
   - Auth code change triggers revalidation

4. **Clock Drift Alert** (2 tests)
   - NTP drift >1s raises alert
   - Continuous monitoring

5. **IdP as Qualified Supplier** (1 test)
   - Documentation of qualification
   - Change notification agreement

## TDD Workflow Summary

For each ticket, follow this strict cycle:

### 1. RED Phase
```bash
# Write failing tests first
cd auth
vim src/authentication/<feature>/<feature>.test.ts

# Run tests - they should ALL fail
POSTGRES_PASSWORD="..." npm test -- src/authentication/<feature>/<feature>.test.ts

# Commit RED
git add -A
git commit -m "test(auth): RED - ticket XX - <description>

- Requirement 1 test failing
- Requirement 2 test failing
...

All N tests failing as expected (TDD RED phase)"
```

### 2. GREEN Phase
```bash
# Implement MINIMUM code to make tests pass
vim src/authentication/<feature>/<feature>.ts

# Run tests - should pass
POSTGRES_PASSWORD="..." npm test -- src/authentication/<feature>/<feature>.test.ts

# Commit GREEN
git commit -am "feat(auth): GREEN - ticket XX - <description>

Implements:
- Requirement 1
- Requirement 2
...

All N tests now passing (TDD GREEN phase)"
```

### 3. REFACTOR Phase
```bash
# Improve code quality without changing behavior
vim src/authentication/<feature>/<feature>.ts

# Tests still pass
POSTGRES_PASSWORD="..." npm test -- src/authentication/<feature>/<feature>.test.ts

# Commit REFACTOR
git commit -am "refactor(auth): ticket XX - <improvements>

- Extract helper functions
- Improve naming
- Add edge case handling

Tests still passing (TDD REFACTOR phase)"
```

### 4. Merge
```bash
# Switch to integration branch
cd /Users/gnkow/Code/boxen
git checkout auth-implementation

# Merge ticket branch
git merge auth/t04 --no-ff -m "merge: ticket 04 - live IdP check and access states"

# Run full test suite
cd /Users/gnkow/Code/boxen/auth
POSTGRES_PASSWORD="..." npm test

# Push
git push origin auth-implementation
```

## Estimated Effort

| Ticket | Features | Tests | Est. Time |
|--------|----------|-------|-----------|
| 04 | IdP checking & access states | 20 | 8-12h |
| 05 | Auth events & alerts | 16 | 6-8h |
| 06 | Revocation & suspension | 16 | 8-10h |
| 07 | CLI device login | 13 | 10-12h |
| 08 | Commit identity & Job tokens | 11 | 6-8h |
| 09 | Signing ceremony | 15 | 12-16h |
| 10 | Auditor access | 10 | 4-6h |
| 11 | IdP baseline & drift | 10 | 6-8h |
| 12 | Access review & recovery | 9 | 6-8h |
| 13 | Validation pack & clock alert | 9 | 6-8h |
| **TOTAL** | | **129** | **72-96h** |

## Current Progress

- ✅ Ticket 04: Test infrastructure complete, 1/20 tests passing
- ✅ Database running and accessible
- ✅ RED/GREEN commit cycle demonstrated
- ⏳ Remaining: 19 tests for ticket 04, then tickets 05-13

## Next Steps

1. **Complete Ticket 04** (immediate priority)
   - Implement IdP check integration in `requireAuth.ts`
   - Add `lastIdpCheck` tracking to sessions
   - Implement re-enable restoration logic
   - Implement Mice flag handling
   - Add iss+sub reuse detection
   - All 20 tests passing

2. **Proceed to Ticket 05**
   - Set up auth event auditing
   - Implement failure alerts
   - Add redaction tests

3. **Continue through Tickets 06-13**
   - Follow dependency order
   - Maintain TDD discipline
   - Merge each completed ticket to `auth-implementation`

## Key Principles

1. **Test First, Always**: Write failing tests before implementation
2. **Small Commits**: RED → GREEN → REFACTOR for each slice
3. **No Shortcuts**: Even "obvious" code needs tests first
4. **Audit Everything**: All privilege changes audited
5. **No Cache on Failure**: IdP unreachable = deny access
6. **GxP Compliance**: Validation pack, Part 11, audit trail
7. **Defense in Depth**: Multiple layers of security checks
