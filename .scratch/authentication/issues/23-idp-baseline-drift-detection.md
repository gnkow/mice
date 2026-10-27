# 23: IdP Baseline Drift Detection (U20)

**What to build:** Daily automated check compares current IdP configuration against a stored baseline. Critical drift (MFA claims missing, token signature algorithm changed) blocks signing. Non-critical drift (group claim format changed) alerts only. Operators can review and update baseline for intentional changes.

**Blocked by:** 14 (IdP MFA baseline validation)

**Status:** completed

## Acceptance Criteria

- [x] Baseline schema: MFA claims available, required OIDC scopes, token signature algorithm, group claim format, issuer
- [x] Daily scheduled check: fetch current IdP config (OIDC discovery), compare vs baseline
- [x] Critical drift detection: MFA claims missing, signature algorithm changed, issuer changed
- [x] Critical drift action: block signing operations (503 error, references drift report ID)
- [x] Non-critical drift: group claim format changed, scope list expanded
- [x] Non-critical drift action: alert only (console WARN, would integrate email/Slack)
- [x] Admin UI: View baseline, view current config, compare, perform check, view reports, establish baseline
- [x] Drift report stored in database as validation evidence (per T5)
- [x] Tests for critical drift (block signing), non-critical drift (alert only), baseline update

## Implementation Summary

**Schema** (`auth/src/db/schema.ts`):
- `idp_baseline` table: id, establishedAt, establishedBy, mfaClaimsAvailable, requiredScopes, signatureAlgorithm, groupClaimFormat, issuer, isCurrent
- `idp_drift_reports` table: id, checkedAt, baselineId, hasCriticalDrift, hasNonCriticalDrift, criticalDrifts, nonCriticalDrifts, currentConfig, error

**Core Logic** (`idpDriftDetection.ts` - 369 lines):
- `getCurrentBaseline()` - Get active baseline configuration
- `getCurrentIdpConfig()` - Fetch current IdP config via OIDC discovery endpoint
- `detectDrift()` - Compare baseline vs current, classify drifts as critical/non-critical
- `performDriftCheck()` - Run check, store report, return results
- `isSigningBlockedByDrift()` - Check if signing should be blocked (critical drift within 25 hours)
- `establishBaseline()` - Create new baseline after reviewing drift as intentional
- `getRecentDriftReports()` - Get recent reports for admin review

**Drift Classification:**
- **Critical** (blocks signing):
  - MFA claims no longer available
  - MFA amr values empty
  - Signature algorithm changed (e.g., RS256→HS256)
  - Issuer changed
- **Non-critical** (alerts only):
  - Group claim format changed (e.g., array→overage)
  - Required scopes expanded

**Admin API Routes** (`idpDriftRoutes.ts` - 184 lines):
- `GET /auth/admin/idp-drift/baseline` - View current active baseline
- `GET /auth/admin/idp-drift/current` - View current IdP configuration
- `GET /auth/admin/idp-drift/compare` - Compare baseline vs current without storing report
- `POST /auth/admin/idp-drift/check` - Perform drift check now and store report
- `GET /auth/admin/idp-drift/reports` - Get recent drift reports (limit param)
- `POST /auth/admin/idp-drift/baseline` - Establish new baseline (requires all config fields)

**Signing Integration** (`signingRoutes.ts`):
- `POST /auth/sign/execute` checks for critical drift before allowing signature
- Returns 503 with `signature.blocked_by_drift` audit event if blocked
- Includes reportId in error response for investigation

**Scheduled Job** (`idpDriftSchedule.ts` - 56 lines):
- `startIdpDriftSchedule()` - Runs every 24 hours
- Performs drift check automatically
- Logs critical drift as ERROR
- Logs non-critical drift as WARN
- Stores all reports as validation evidence

**Bootstrap** (`boot.ts`):
- `startIdpDriftSchedule()` started on boot alongside other scheduled jobs

**Test Coverage** (14 tests, all passing):
- Baseline establishment and superseding
- Current baseline retrieval
- Critical drift detection (MFA missing, MFA empty, algorithm changed, issuer changed)
- Non-critical drift detection (group format, scopes expanded)
- Multiple drift detection
- No drift detection
- Signing block when critical drift recent (<25h)
- No signing block when drift old (>25h)
- No signing block when only non-critical drift

## Context

Round 8 decision U20 addresses lines 692-693 in spec: "The IT team removes the `amr` claim from tokens on a Tuesday. Signing silently stops evidencing MFA until someone notices."

IdP configuration changes can invalidate the platform's validated state. Daily baseline drift detection makes these changes visible and actionable (critical changes block operations, non-critical changes alert).

## Future Work

- Test login integration to detect MFA claims from actual id_tokens (currently uses discovery only)
- Email/Slack alert integration for drift notifications
- Admin UI dashboard for visualizing drift history
- Automatic baseline suggestion when non-critical drift persists
- Integration with notification system for security admin alerts
