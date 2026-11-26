# Authentication Architecture

## Overview

Mice authentication follows a **device-flow-only** approach per the authentication specification (`respec/01-authentication/spec.md`).

> **"There are no PATs and no service principals"** (spec line 34)

## Authentication Methods

### 1. Web Browser (SSO)
- **Method:** OpenID Connect (OIDC) flow
- **Lifetime:** 8 hours absolute, 15 minutes idle timeout (the instance refuses to start with looser values)
- **Storage:** Server-side session with HTTP-only cookie
- **Use case:** Human users in web browsers

### 2. CLI (Device Flow)
- **Method:** RFC 8628 device authorization grant
- **Command:** `mice login`
- **Lifetime:** 8-hour access token + rotating refresh (30-day family cap)
- **Storage:** OS keychain, per Principal
- **Use case:** Human users on command line
- **Security:**
  - IdP rechecked on each refresh
  - Reuse detection
  - Single Principal per OS user (shared credentials forbidden)

### 3. Jobs (Internal)
- **Method:** BFF-internal tokens
- **Lifetime:** Job runtime
- **Attribution:** Submitting user + "performed by Job <id>"
- **Use case:** Automated actions within Mice
- **Note:** Jobs cannot electronically sign

## What Was Removed

### ❌ Personal Access Tokens (PATs)
**Removed because:** Spec requires short-lived credentials only

**Previously allowed:**
- Manual token creation via UI
- Long-lived tokens (90-365 days)
- CI/automation use

**Now use instead:**
- Device flow (`mice login`) for humans
- Jobs for automation (attributed to submitter)

### ❌ Service Principals
**Removed because:** Spec states "no service principals"

**Previously allowed:**
- CI identity accounts
- Admin-managed service accounts
- PAT minting for services

**Now use instead:**
- Jobs (BFF-internal tokens)
- No external CI support

## CLI login

```bash
mice login
mice clone http://localhost:8080/ns/repo
mice push
```

### For CI/Automation

**Old approach:** PATs or service principals
**New approach:** **Not supported** - CI is explicitly out of scope per spec

**For internal automation:** Use Jobs (BFF-internal tokens, attributed to submitter)

## Code Structure

```
auth/src/authentication/
├── credentials/
│   ├── deviceFlow.ts          ✅ RFC 8628 device flow
│   ├── cliDeviceRoutes.ts     ✅ Device flow endpoints
│   ├── revocationRoutes.ts    ✅ Revocation
│   ├── selfRevocation.ts      ✅ Sign out everywhere
│   ├── [removed] tokens.ts    ❌ PAT implementation
│   ├── [removed] tokenRoutes.ts ❌ PAT endpoints
│   ├── [removed] servicePrincipals.ts ❌ Service principals
│   └── [removed] servicePrincipalRoutes.ts ❌ Service principal endpoints
├── session/
│   ├── session.ts             ✅ Web sessions
│   ├── requireAuth.ts         ✅ Authentication middleware
│   └── webSessionRoutes.ts    ✅ Session management API
├── oidc/
│   ├── loginFlow.ts           ✅ OIDC login
│   └── stepUp.ts              ✅ Re-authentication
└── directory/
    └── directorySync.ts       ✅ IdP sync
```

## Security Features

### IdP Integration
- **Live checks:** Login, refresh, signing, privileged mutations
- **Throttling:** Ordinary requests checked at most every 5 minutes
- **Fail-closed:** IdP unreachable = access denied (no cache)
- **Re-enable logic:**
  - ≤30 days: Automatic restore
  - >30 days: Admin re-confirmation required

### Group Overage Handling
Some IdPs (Microsoft Entra ID, Okta) omit the groups claim when a user belongs to many groups (typically >200). Instead, they return an **overage indicator** that requires a separate directory API call to fetch the full group list.

**Overage Detection:**
- Microsoft Entra ID: `_claim_names.groups` present in id_token
- Okta: `_claim_sources` present (future support)
- Automatically detected during login

**Directory API Fallback:**
- When overage detected, Mice calls the directory API to fetch groups
- Microsoft Entra ID: `GET /users/{id}/memberOf` (Microsoft Graph API)
- Keycloak: `GET /admin/realms/{realm}/users/{id}/groups` (Keycloak Admin API)
- Groups normalized and stored in session (same as direct claims)

**Fail-Closed Behavior:**
- If IdP returns overage AND directory API fails → login fails with 500
- Error: "Group membership could not be determined. Please contact your administrator."
- Prevents users from logging in with incomplete group data
- Both IdP and directory must succeed for login

**Configuration:**
```env
# Keycloak directory (for overage fallback)
DIRECTORY_PROVIDER=keycloak
KEYCLOAK_ADMIN_URL=http://keycloak:8080
KEYCLOAK_REALM=mice

# OIDC (uses same credentials for directory API)
OIDC_ISSUER=http://keycloak:8080/realms/mice
OIDC_CLIENT_ID=mice-web
OIDC_CLIENT_SECRET=your-secret
```

**Microsoft Entra ID Setup:**
1. Register app in Azure Portal
2. Grant API permissions: `User.Read.All`, `GroupMember.Read.All`
3. Configure `KEYCLOAK_ADMIN_URL` to point to Microsoft Graph proxy
4. Mice detects `_claim_names.groups` and fetches via Graph API

**Testing:**
- Overage simulation: Set `groupsOverage: true` in fake OIDC provider
- Directory mock: `createFakeDirectory({ userGroups: { sub: [...] } })`
- Tests: `auth/src/authentication/oidc/groupOverage.test.ts` (12 tests)

**Observability:**
```
[mice-auth] Fetched 237 groups from directory for user alice@example.com (overage recovery)
[mice-auth] Group overage detected but directory not configured. Login will fail.
[mice-auth] Group overage for user bob@example.com but directory returned no groups.
```

**Related Files:**
- `auth/src/authentication/oidc/groupOverage.ts` - Detection and fetching
- `auth/src/authentication/oidc/loginFlow.ts` - Integration into login
- `auth/src/authentication/directory/directoryKeycloak.ts` - Keycloak Admin API
- Ticket: `.scratch/authentication/issues/18-group-overage-handling.md`

### Revocation
- **Scope:** All sessions + CLI credentials
- **Triggers:**
  - Manual (user or admin)
  - Directory sync
  - Back-channel logout
  - Role/grant changes
- **Effect:** Immediate (no cache)

### Audit Trail
- **Events:** Login, logout, refresh, step-up, failure, revocation
- **Data:** Request ID + Principal (no IPs, tokens, or codes)
- **Storage:** ImmuDB (immutable)

## API Endpoints

### ✅ Available
```
GET  /auth/login              SSO login initiation
GET  /auth/callback           OIDC callback
POST /auth/logout             Logout (web + CLI)
GET  /auth/me                 Current session info
GET  /auth/sessions/web       List web sessions
DELETE /auth/sessions/web/:id Revoke one session
POST /auth/sessions/revoke-all Sign out everywhere

GET  /auth/cli/device/start   Device flow initiation
POST /auth/cli/device/approve Approve device code
POST /auth/cli/device/poll    Poll for token
POST /auth/cli/logout         CLI logout
```

### ❌ Removed
```
GET    /auth/tokens          (was: List PATs)
POST   /auth/tokens          (was: Create PAT)
DELETE /auth/tokens/:id      (was: Revoke PAT)

GET    /auth/instance/service-principals           (was: List service principals)
POST   /auth/instance/service-principals           (was: Create service principal)
GET    /auth/instance/service-principals/:id/tokens (was: List SP tokens)
POST   /auth/instance/service-principals/:id/tokens (was: Mint SP token)
```

## Testing

Tests remain in place for removed features (for historical reference):
- `auth/src/authentication/credentials/tokens.test.ts`
- `auth/src/authentication/credentials/servicePrincipals.test.ts`

Active tests:
- `auth/src/authentication/credentials/deviceFlow.test.ts` (RFC 8628)
- `auth/src/authentication/session/session.test.ts` (Web sessions)
- `auth/src/authentication/oidc/loginFlow.test.ts` (OIDC)

## Regulatory Compliance

Per 21 CFR Part 11 and EU Annex 11:
- ✅ Electronic signatures require fresh auth (<5 min) + MFA
- ✅ All authentication events audited
- ✅ No credential sharing (enforced)
- ✅ Quarterly access reviews
- ✅ IdP baseline validation

## References

- **Spec:** `respec/01-authentication/spec.md`
- **Tickets:** `.scratch/authentication/issues/07-cli-device-login.md`
- **RFC 8628:** OAuth 2.0 Device Authorization Grant
