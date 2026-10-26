---
status: proposed
---

# GxP strict mode is always on; service principals and personal access tokens are removed

## Context

`GXP_STRICT` was a switch, and automation used service principals and long-lived PATs. The interview (04 Q10, 00 Q19, 01 Q5, Q12-Q14) found that a switch means unvalidated configurations, and that PATs outlive the IdP account of a leaver (01 Q5) and cannot satisfy step-up or name a responsible human.

## Decision

- Strict behaviour (refuse any mutation whose Intent cannot be stored, signature rules, mandatory recording for GxP Sessions) is always on. There is no flag and no non-strict mode. Whether research repos need an exemption is still open and would be a new decision.
- Service principals are removed. Every event carries a responsible human owner; nothing but a human can sign.
- No PATs. `mice login` issues a short-lived (8-24 h), refreshable credential stored in the OS keychain; signing steps up with a fresh IdP login (device flow for the CLI).
- Jobs act under the human who started them, with an audit-only `via` field.
- Revocation and directory sync apply to these credentials (01 Q1-Q4).

## Consequences

- Fail-closed is absolute: an immudb outage blocks mutations, revoke and login (accepted risk, documented; paper fallback, no break-glass).
- CI and unattended automation need a human-owned approach; no long-lived machine identity exists.
- Dev and test setups run in strict too, so fixtures need audit available.
- Scopes reference stable repository ids with action-level scopes (01 Q27).

## Alternatives rejected

- Keep `GXP_STRICT` switchable or per-repo: unvalidated configurations.
- Service principals with named owners and expiry: still unattended and unsignable.
- Shorter PATs (30-90 days): still outlive the leaver.
