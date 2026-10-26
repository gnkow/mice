# Authentication Architecture

## Overview

Mice authentication follows a **device-flow-only** approach per the authentication specification (`respec/01-authentication/spec.md`).

> **"There are no PATs and no service principals"** (spec line 34)

## Authentication Methods

### 1. Web Browser (SSO)
- **Method:** OpenID Connect (OIDC) flow
- **Lifetime:** 8 hours absolute, 30 minutes idle timeout
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

## Migration Guide

### For Users with Existing PATs

**Old workflow:**
```bash
# Created PAT via UI
export TOKEN="mice_pat_..."
oxen config --auth localhost:8080 $TOKEN
oxen clone http://localhost:8080/ns/repo
```

**New workflow:**
```bash
# Use device flow
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
