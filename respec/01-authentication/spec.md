Status: ready-for-agent

# 01 — Authentication (PLAT-AUTH)

## Problem Statement

Users, CLI tools and automation need to prove who they are to Mice, and every request must carry an attributable Principal. Credentials must be revocable immediately because offboarding is manual.

## Solution

SSO login through an external IdP yields a sealed Session cookie; automation uses scoped PATs. The BFF authenticates every request, keys the Principal by IdP `iss`+`sub`, and injects commit author identity. Admins can revoke all Sessions and PATs of a Principal at once. Service principals exist for automation owned by a user.

## User Stories

1. As a scientist, I want to sign in with my organisation's SSO, so that I do not manage another password.
2. As a scientist, I want my session to expire after inactivity, so that an unattended browser is not a risk.
3. As a CLI user, I want to log in through a device flow, so that I get a PAT without pasting secrets.
4. As an automation owner, I want to mint a PAT with scopes and an expiry, so that scripts have least privilege.
5. As a user, I want to see and revoke my own PATs, so that I can respond to leaks.
6. As an instance admin, I want to revoke all Sessions and PATs of a Principal by `iss`+`sub`, so that offboarding takes effect immediately.
7. As an instance admin, I want a UI action for that revoke, so that I do not need the API.
8. As an auditor, I want every login, logout, failure, mint and revoke audited, so that identity events are attributable.
9. As a compliance lead, I want step-up re-authentication for sensitive actions, so that e-signatures rest on fresh proof of identity.
10. As a repository collaborator, I want my commits authored with my IdP name and email, so that history is attributable (author injection).
11. As an automation owner, I want a service principal (`urn:mice:service|<uuid>`), so that jobs do not run as a person.
12. As an instance admin, I want service principals suspended when their owner is revoked, so that orphaned automation stops.
13. As an operator, I want production to refuse to start with dev defaults, so that weak auth never ships.
14. As a user with a changed `sub` or a different IdP, I want to be treated as a distinct Principal, so that identities are never merged silently.

## Implementation Decisions

- Principal identity is `iss`+`sub` (ADR 0001); no cross-IdP merging.
- Sessions are sealed cookies; PATs are `mice_pat_*` with hashed storage and optional scopes and expiry.
- Revocation uses a not-valid-before cut-off per Principal; PATs and Sessions created at or before it are rejected on every instance.
- Group claims are snapshotted at login and at PAT mint; immediate shrinkage is achieved by revocation, not live directory re-checks.
- Offboarding is manual and documented; no SCIM or directory sync.
- Service principals: owned by a user, suspended automatically when the owner is revoked, audited like other Principals.
- Step-up: a reauthentication mechanism with max-age check, consumed by GxP e-signatures.
- Production requires an external IdP; Keycloak is development-only.
- All state in PostgreSQL; multiple BFF instances share revocation state.

## Testing Decisions

- Test through the BFF HTTP boundary: login callback, cookie behaviour, PAT use, revoke, step-up.
- Revocation is tested across two BFF instances.
- Prior art: existing auth API tests and the Playwright login flow.

## Out of Scope

SCIM, directory sync, back-channel logout, keychain storage in the CLI, SAML beyond IdP brokering.

## Further Notes

Stale IdP group membership remains effective until revoke or re-login; this is a documented consequence of manual offboarding.
