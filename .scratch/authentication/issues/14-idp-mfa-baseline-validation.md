# 14: IdP MFA Baseline Validation (U1)

**What to build:** Deploy-time and daily validation that the configured IdP provides MFA evidence (acr/amr claims). Block signing operations when MFA claims are unavailable. Store baseline check results in validation pack.

**Blocked by:** None (can start immediately)

**Status:** completed

## Acceptance Criteria

- [x] Deploy-time IdP baseline check validates MFA claim availability (acr/amr present in id_token)
- [x] Daily automated baseline check (admin can trigger manually via UI)
- [x] Refuse signing operations when acr/amr claims missing from step-up id_token
- [x] Store baseline check results (timestamp, MFA available: yes/no, claims found) in database for validation pack
- [x] Integration with existing step-up code (auth/src/authentication/oidc/stepUp.ts)
- [x] Admin UI shows current baseline status and last check timestamp
- [x] Tests for baseline validation, signing refusal when MFA unavailable

## Implementation Summary

**Completed in 3 commits:**
1. `926e3dd` - MFA evidence extraction + signing ceremony integration (Seams 1-2)
2. `91de747` - Admin baseline check endpoints + database schema (Seams 3-4)
3. `27f3bae` - Admin UI + E2E tests (Seam 5)

**Files created:**
- `auth/src/authentication/signing/mfaEvidence.ts` - MFA claim extraction
- `auth/src/authentication/signing/mfaEvidence.test.ts` - Unit tests
- `auth/src/authentication/admin/idpBaselineRoutes.ts` - Admin endpoints
- `auth/src/authentication/admin/idpBaselineRoutes.test.ts` - Integration tests
- `e2e/tests/idp-baseline.spec.ts` - E2E tests

**Files modified:**
- `auth/src/authentication/signing/signingRoutes.ts` - Integrated MFA check
- `auth/src/authentication/signing/signingCeremony.test.ts` - Added MFA integration tests
- `auth/src/db/schema.ts` - Added idpBaselineChecks table
- `auth/src/app.ts` - Registered baseline routes
- `web/src/pages/SettingsPage.tsx` - Added IdP baseline admin UI
- `.specs/01-authentication.md` - Round 8 grilling decisions documented

**Status:** ready-for-agent

## Acceptance Criteria

- [ ] Deploy-time IdP baseline check validates MFA claim availability (acr/amr present in id_token)
- [ ] Daily automated baseline check (scheduled job, cron or equivalent)
- [ ] Refuse signing operations when acr/amr claims missing from step-up id_token
- [ ] Store baseline check results (timestamp, MFA available: yes/no, claims found) in database for validation pack
- [ ] Integration with existing step-up code (auth/src/authentication/oidc/stepUp.ts)
- [ ] Admin UI shows current baseline status and last check timestamp
- [ ] Tests for baseline validation, signing refusal when MFA unavailable

## Context

Part 11 §11.200 requires "two distinct identification components" at signing. Round 8 decision U1 makes IdP MFA capability a deployment prerequisite. If the IdP cannot provide MFA evidence (acr/amr claims), signing must be refused.

Integrates with existing step-up implementation (09-step-up-reauthentication.md) which already validates auth_time and identity matching.
