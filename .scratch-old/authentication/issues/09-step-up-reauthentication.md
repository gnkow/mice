# 09: Step-up re-authentication

**What to build:** Sensitive actions require fresh proof of identity through IdP re-authentication. Step-up validates the user re-authenticated at the IdP within a configurable time window and that the returned identity matches the current session.

**Blocked by:** 01 (OIDC login flow), 03 (session management)

**Status:** ready-for-agent (core implementation exists, needs MFA evidence extraction)

**Domain boundary:** This ticket covers authentication-domain concerns only (identity verification, freshness validation). GxP-specific signature ceremonies are in 04-gxp-compliance.

## Requirements

- [x] Step-up through OIDC with `prompt=login` and `max_age` parameter
- [x] Fresh authentication window configurable (default 5 minutes, signing uses 60 seconds)
- [x] Returned `sub`+`iss` must match current session (prevent identity substitution)
- [x] `auth_time` claim validated against local clock with drift tolerance
- [x] Session cookie refreshed with new `auth_time` on successful step-up
- [x] PATs/device-flow credentials cannot satisfy step-up (Session-only)
- [x] Browser redirects to re-auth if stale; API returns 401 with `reauthUrl`
- [x] CLI step-up through device flow (future: same UX as web)
- [ ] MFA evidence extraction from IdP claims (acr/amr/authentication_method)
- [ ] IdP baseline validation: MFA capability verified at deploy time
- [ ] Refuse step-up when IdP provides no MFA evidence

## Implementation Status

**Completed (auth/src/authentication/oidc/stepUp.ts):**
- `reauthenticate(c, maxAgeSec)` - demands fresh authentication for protected actions
- `isFreshlyAuthenticated(user, maxAgeSec)` - checks auth_time freshness
- GET /auth/reauth - initiates step-up with next parameter
- Demo endpoint: GET /auth/step-up/demo
- Audit events for step-up success and failure
- Identity matching validation (prevents colleague login during step-up)

**Remaining work:**
- MFA evidence extraction from id_token claims (acr, amr, authentication_method)
- IdP MFA capability validation (deploy-time check)
- Refusal logic when MFA evidence missing
- CLI device-flow step-up integration

## Integration Points

**Used by:**
- 04-gxp-compliance: Signing ceremony (60s freshness requirement)
- Future: Privileged settings changes, admin actions

**Dependencies:**
- OIDC login flow provides id_token with auth_time claim
- Session management provides current session state
- Audit log records step-up events

## Related Specs

- 01-authentication spec: User story #9, Implementation decision on step-up
- 04-gxp-compliance spec: User story #2 (maintainer signs with fresh re-authentication)

## Testing

**Existing tests (auth/src/authentication/oidc/stepUp.test.ts):**
- Fresh authentication acceptance
- Stale authentication rejection
- Identity mismatch detection
- Session refresh on successful step-up
- PAT rejection for step-up

**Additional tests needed:**
- MFA evidence validation
- IdP capability check
- Clock drift tolerance
- CLI device-flow step-up
