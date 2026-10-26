# 23: IdP Baseline Drift Detection (U20)

**What to build:** Daily automated check compares current IdP configuration against a stored baseline. Critical drift (MFA claims missing, token signature algorithm changed) blocks signing. Non-critical drift (group claim format changed) alerts only. Operators can review and update baseline for intentional changes.

**Blocked by:** 14 (IdP MFA baseline validation)

**Status:** ready-for-agent

## Acceptance Criteria

- [ ] Baseline schema: MFA claims available (bool), required OIDC scopes (array), token signature algorithm (string, e.g., RS256), group claim format (string, e.g., array vs overage)
- [ ] Daily scheduled check: fetch current IdP config (OIDC discovery, test login), compare vs baseline
- [ ] Critical drift detection: MFA claims missing, signature algorithm changed (RS256→HS256), issuer changed
- [ ] Critical drift action: block signing operations (signing ceremony refuses, error message references drift)
- [ ] Non-critical drift: group claim format changed, scope list expanded
- [ ] Non-critical drift action: alert only (email/Slack to security admins)
- [ ] Admin UI: View baseline, view current config, view drift report, "Update baseline" button (after reviewing drift as intentional)
- [ ] Drift report stored in database as validation evidence (per T5)
- [ ] Tests for critical drift (block signing), non-critical drift (alert only), baseline update

## Context

Round 8 decision U20 addresses lines 692-693 in spec: "The IT team removes the `amr` claim from tokens on a Tuesday. Signing silently stops evidencing MFA until someone notices."

IdP configuration changes can invalidate the platform's validated state. Daily baseline drift detection makes these changes visible and actionable (critical changes block operations, non-critical changes alert).
