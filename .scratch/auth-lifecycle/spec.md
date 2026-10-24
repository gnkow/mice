Status: ready-for-agent

# Auth lifecycle: revocation, token verification, deprovisioning, service principals

Source plan: `plans/01-authentication.md` Phases 2.6, 2.7, 3 and 4 (all "proposed, not approved" there; this spec is the approval to ticket them). Design record: ADR 0001 (BFF identity trust model). Builds on the shipped `auth-hardening` spec.

## Problem Statement

Mice Principals are authenticated well at login but badly managed afterwards. Offboarding depends on an admin remembering to revoke sessions. Users cannot sign themselves out everywhere. A GxP-strict deployment can start with the idle timeout switched off. The id_token signature is never verified. PAT scope handling is scattered across several modules and undocumented. There is no way to run CI without tying credentials to a person who will eventually leave. SAML customers have no tested path. E-signatures need a re-authentication mechanism that does not exist.

## Solution

Close the credential lifecycle in four increments:

- **2.6**: users can revoke their own Sessions; GxP-strict refuses to start without an idle timeout; scoped-credential checks are consolidated behind one rule.
- **2.7**: the id_token signature is verified against the IdP's key set, by default in GxP-strict mode, and production requires an `https` issuer.
- **3**: a tested SAML-via-Keycloak recipe; IdP back-channel logout; automatic revocation of Principals disabled in the directory; a step-up re-authentication mechanism for e-signatures.
- **4**: admin-created service principals for CI, owned by a human and suspended (not deleted) when the owner is offboarded.

## User Stories

1. As a User, I want a "sign out everywhere" button on my Profile, so that a lost laptop does not leave a live Session.
2. As a User, I want sign-out-everywhere to leave my PATs alone by default, so that my CI jobs do not break when I clean up browser Sessions.
3. As a User, I want an explicit option to also revoke my PATs at the same time, so that I can respond to a full credential leak in one step.
4. As a User, I want to see confirmation that all other Sessions were ended, so that I trust the action worked.
5. As an instance admin, I want sign-out-everywhere to be audited with the Principal and the reason, so that I can reconstruct what happened.
6. As a compliance officer, I want GxP-strict mode to refuse to start when the idle timeout is off, so that a validated deployment cannot silently run without Part 11 session controls.
7. As an operator, I want a clear startup error naming the missing setting, so that I can fix the configuration without reading source.
8. As an operator of a non-strict deployment, I want startup behaviour unchanged, so that existing environments keep working.
9. As a maintainer, I want one rule that answers "is this a scoped credential", so that new routes cannot forget to refuse scoped PATs.
10. As a User with a scoped PAT, I want per-user routes (notifications, favorites) to reject my token consistently, so that behaviour is predictable.
11. As a User, I want to see in Settings and the CLI help what PAT scopes mean (namespace, optional repo, maximum role), so that I can mint least-privilege tokens.
12. As a User, I want to set scopes when I mint a PAT in the UI and in `mice`, so that I do not have to hand-edit requests.
13. As a security officer, I want the id_token signature verified with the IdP's published keys, so that a forged token cannot create a Session.
14. As a security officer, I want only RS256 and ES256 accepted, so that `alg: none` or downgrade tricks fail.
15. As a security officer, I want login to fail closed with an error when the key set cannot be fetched, so that an IdP outage never lowers security.
16. As an operator, I want key rotation at the IdP to work without a restart, so that routine rotation does not cause an outage.
17. As an operator, I want signature verification on by default in GxP-strict mode and unchanged elsewhere, so that I can adopt it deliberately.
18. As an operator, I want production to refuse a non-`https` issuer, so that tokens are never fetched over plaintext.
19. As an enterprise admin using SAML, I want a documented Keycloak brokering recipe, so that I can onboard a SAML IdP without native SAML in the BFF.
20. As a maintainer, I want that recipe covered by an automated test, so that Keycloak upgrades do not silently break it.
21. As an IdP admin, I want the BFF to accept back-channel logout, so that logging a user out of the IdP ends their Mice Sessions.
22. As a User, I want an IdP logout to end my Sessions but not my PATs, so that logout is not treated as offboarding.
23. As a security officer, I want a forged or expired logout token rejected, so that nobody can log other users out.
24. As an instance admin, I want Principals that are disabled or removed in the IdP revoked automatically (Sessions and PATs), so that offboarding does not depend on a manual step.
25. As an instance admin, I want to run the directory sync on demand, so that I can offboard immediately in an incident.
26. As an operator, I want the sync interval configurable (default 15 minutes), so that I can balance load and speed.
27. As an operator, I want a directory outage to revoke nobody, so that an IdP blip does not lock out the whole company.
28. As an instance admin, I want an audit event and a notification when the sync is stale beyond twice its interval, so that I know offboarding is not running.
29. As an auditor, I want every automatic revocation recorded with the Principal and the source (directory sync, back-channel logout, self-service, admin), so that I can explain any lost access.
30. As a signer, I want the system to demand fresh authentication (maximum age) before an e-signature, so that a stolen Session cannot sign.
31. As a signer, I want a failed re-authentication to leave the original action unperformed, so that nothing is signed by accident.
32. As a GxP owner, I want AUTH to provide the mechanism and GxP to decide when it applies, so that policy stays in one place.
33. As an instance admin, I want to create a service principal for CI with a required human owner, so that automation has an identity that is not a person.
34. As a service principal owner, I want to mint PATs for it under the same expiry rules as human PATs, so that long-lived tokens remain bounded.
35. As a service principal owner, I want to be notified before its PAT expires, so that CI does not fail unexpectedly.
36. As an instance admin, I want a service principal suspended (not deleted) when its owner is offboarded, so that CI fails visibly and can be reassigned.
37. As an instance admin, I want to reassign a suspended service principal to a new owner and reactivate it, so that pipelines recover without new credentials.
38. As an auditor, I want service principals distinguishable from Users in every audit event, so that automated changes are attributable to a pipeline and an owner.
39. As an instance admin, I want a service principal's namespace and repo access granted through the normal authorization model, so that there is no separate permission system.
40. As a security officer, I want the reserved service issuer rejected as an OIDC issuer at startup, so that an IdP can never mint a token that impersonates a service principal.
41. As an operator, I want all of the above to default off or unchanged for existing deployments, so that upgrading is safe.
42. As a developer, I want each increment to ship independently, so that value lands early and risk stays small.

## Implementation Decisions

- **Two revocation cut-offs per Principal.** Credential revocation records a sessions-only cut-off and a full cut-off (Sessions and PATs created at or before it). Sign-out-everywhere and back-channel logout set the sessions-only cut-off. Admin revocation and directory-sync set the full cut-off. The credential-validity check consults the right cut-off for the credential type. Existing stored cut-offs are read as full cut-offs, so behaviour stays the same after upgrade.
- **Self-service revocation** is an authenticated, same-origin, Session-only action (not available to PATs) that sets the sessions-only cut-off, with an optional "also revoke PATs" flag that sets the full cut-off. It is audited.
- **GxP-strict startup gate** adds one rule to the existing production gate: idle timeout must be greater than zero. The value policy stays in the GxP plan.
- **Scoped-credential consolidation.** One predicate on the Principal answers "is this a scoped credential". Authorization capping and per-user-route refusal call it. Behaviour is unchanged; this is a refactor with the existing tests as the safety net.
- **PAT scope surfacing.** Scope data already exists as namespace, optional repo and maximum role. Settings and `mice` gain scope input at mint time (verify what is already present first), and help text explains the model.
- **id_token verification.** Verify against the IdP's remote key set with a maintained JWT library (the only new dependency), cached with the library's default rotation. Allowed algorithms: RS256 and ES256. Only the id_token is verified. Key-set fetch failure at login returns an error and creates no Session. Enabled by default in GxP-strict mode, opt-in elsewhere; the ADR's "no signature check" stays the default for non-strict.
- **Issuer gate.** Production startup refuses a non-`https` issuer.
- **SAML.** The BFF stays OIDC-only. One documented Keycloak brokering recipe plus an e2e case. No SAML code in the BFF.
- **Back-channel logout.** A new endpoint accepts the IdP's logout token, validates signature, issuer, audience, expiry and the logout event claim, then sets the sessions-only cut-off for the Principal named by `iss`+`sub`. Replayed tokens are harmless because cut-offs are monotonic.
- **Directory sync.** A scheduled job (interval env-configurable, default 15 minutes) plus an admin-triggered run asks the directory client for enabled users and sets the full cut-off for Principals that are disabled or removed. If the directory is unreachable it revokes nobody, records an audit event, and notifies admins when the last successful run is older than twice the interval.
- **Step-up re-authentication.** A mechanism that redirects to the IdP with forced login and a maximum age, then verifies a fresh authentication time before returning to the caller. AUTH exposes the mechanism; the GxP e-signature feature decides when to call it. PATs can never satisfy it.
- **Service principals.** Identified as `urn:mice:service|<uuid>` through the existing Principal key functions, so authorization, audit and favorites consumers need no special parsing. The reserved issuer is rejected as an OIDC issuer at config load. Each has a required human owner, an active/suspended state and PATs under the same expiry rules. Owner offboarding (directory sync or admin revocation) suspends the principal; suspension rejects its credentials but keeps its record and audit history. Reassignment reactivates it. Creation is instance-admin only. Namespace and repo access go through the normal authorization model, with the authorization plan specifying membership details.
- **Audit sources.** Every revocation event carries a source label: self-service, admin, back-channel logout, directory sync.
- **Order of delivery:** 2.6, 2.7, 3 (SAML recipe, back-channel logout, directory sync, step-up), 4. GxP Phase 1 in the GxP plan still lands first.

## Testing Decisions

- A good test exercises behaviour at the HTTP boundary (status codes, cookies, audit records, startup refusal) and never asserts on internal function calls or storage layout.
- **One seam:** the Hono wiring driven with `app.request()`, with environment injected through `loadEnv(src)`, a fake clock through `Date.now`, a stub IdP (token endpoint, key set, logout tokens) and a stub directory client. All four increments are tested here. Pure modules (revocation, Principal keys) are covered through this seam only.
- **E2E extension (Playwright + Keycloak):** only the SAML brokering recipe and the Profile "sign out everywhere" flow.
- Prior art: the app-wiring tests that mount the guards and `requireAuth` on a Hono app and seal cookies directly; login-flow tests with a stubbed token exchange; revocation tests that mock `Date.now`; idle-timeout tests; startup-gate tests; the existing auth and CLI-auth e2e specs.
- Set environment variables before dynamic imports (modules still read `env` at import time).
- Write tests first, one behaviour at a time (red-green), per the TDD skill.

## Out of Scope

- SCIM.
- Native SAML in the BFF.
- Per-device Session lists or server-side Session storage.
- Verifying access tokens (none are used).
- Choosing the validated idle-timeout value (owned by the GxP plan).
- E-signature feature itself (only the re-authentication mechanism).
- Service principal self-service creation by non-admins; their authorization model details beyond "normal authorization".
- Repo-level PAT scope redesign.

## Further Notes

- Vocabulary follows `GLOSSARY.md`: Principal, Session (the sealed cookie, not a Desktop Session), PAT, BFF.
- Phase 4 touches Principal identity and authorization membership, so it should get its own design review (grilling) before tickets are cut; the spec's decisions are the starting point.
- The two-cut-off change must keep old stored revocations valid; call this out in the ticket for it.
- Cross-plan mirrors already exist: GxP (idle gate, step-up), authorization (service principal question, directory outage), EPICS (PLAT-AUTH proposed items).

## Service principal design decisions (ticket 12)

- **Permissions:** a service principal is never an instance admin and belongs to no directory group. Access comes only from explicit namespace and repo grants in the normal authorization model.
- **Audit actor:** actor is `urn:mice:service|<uuid>`, with `actorKind: "service"` and `owner` (the owner's Principal at event time) on every event.
- **Favorites and notifications:** no favorites (no UI session). Notifications about a service principal (PAT expiry, suspension) go to its owner, not to the principal.
- **PAT-only identity:** no sessions, only PATs. PATs may be scoped (`ns[/repo]:role`) and are capped by the principal's grants. An unscoped PAT equals the principal's full grants. Sign-out-everywhere and step-up do not apply.
- **Ownership and revocation:** owner offboarding suspends the principal (reversible, PATs rejected, record kept). Admin revocation of the principal is a full cut-off for existing PATs; new PATs can be minted after reactivation. The owner must be an active human; reassigning to a service principal is rejected.
- **Tickets 13–15:** confirmed unchanged. No ADR: the trust model is unchanged.
