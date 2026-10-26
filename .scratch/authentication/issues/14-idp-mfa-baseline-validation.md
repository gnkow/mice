# 14: IdP MFA Baseline Validation (U1)

**What to build:** Deploy-time and daily validation that the configured IdP provides MFA evidence (acr/amr claims). Block signing operations when MFA claims are unavailable. Store baseline check results in validation pack.

**Blocked by:** None (can start immediately)

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
