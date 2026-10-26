Status: ready-for-agent

# AUTH hardening: sessions, PATs and identity trust (PLAT-AUTH Phase 2.5)

## Problem Statement

Interactive and automated Principals authenticate through the BFF, but several gaps weaken attribution and access control. Author injection passes unparseable or unclassified write bodies through unchanged, so a client can forge commit authors. Sessions cannot be revoked or idled out. PATs never expire. Bootstrap admins are matched by unverified email or bare `sub`. The id_token is accepted without claim checks. Production can start with dev secrets. A validated (GxP) deployment cannot rely on any of this.

## Solution

Harden the BFF so every Principal is keyed on `iss`+`sub`, author attribution cannot be forged, Sessions can be revoked and idle out, PATs expire, and the BFF refuses to start in production with default secrets. Decisions are recorded in ADR 0001.

## User Stories

1. As an auditor, I want every commit author to come from the Principal's IdP claims, so that attribution cannot be forged.
2. As an auditor, I want write requests with unparseable or unclassified bodies rejected, so that no request carries client-chosen author fields past the BFF.
3. As a platform engineer, I want author-free write routes (such as binary uploads) on an explicit allowlist, so that legitimate uploads keep working.
4. As a platform engineer, I want new oxen write routes to be unproxyable until classified, so that coverage gaps fail closed.
5. As a User, I want cross-site requests that ride my Session cookie rejected, so that other sites cannot act as me.
6. As a CLI user, I want PAT requests exempt from the Origin check, so that automation keeps working.
7. As an instance admin, I want to revoke all Sessions of a Principal, so that a departing or compromised User loses access immediately.
8. As an instance admin, I want revocation to apply per `iss`+`sub`, so that it cannot hit a different IdP's identity.
9. As a User, I want to be signed out after an idle period, so that an unattended browser is not a risk.
10. As a compliance owner, I want the idle period set by `SESSION_IDLE_SEC`, so that it matches our validated configuration.
11. As a User, I want my Session to stay valid while I am active, so that I am not interrupted mid-work.
12. As a User, I want PATs to require an expiry (default 90 days, max 365), so that forgotten tokens stop working.
13. As a User, I want to see when each PAT was last used, so that I can spot and revoke unused ones.
14. As a platform operator, I want existing PATs grandfathered to 365 days from migration, so that upgrading does not break automation.
15. As an instance admin, I want bootstrap admins matched only by `iss`+`sub` or a verified email, so that a self-registered address cannot gain admin.
16. As an instance admin, I want the synthetic `<sub>@users.local` fallback never to match a bootstrap entry, so that missing email claims cannot grant roles.
17. As an auditor, I want memberships, bootstrap entries and audit actors keyed on `iss`+`sub`, so that a reused `sub` across IdPs cannot be confused.
18. As a platform operator, I want a one-off migration of existing stores to `iss`+`sub`, so that current access survives the upgrade.
19. As a security reviewer, I want the id_token's `iss`, `aud`, `exp` and `nonce` validated at login, so that a wrong-audience or replayed token is rejected.
20. As a GxP owner, I want `auth_time` captured in the Session, so that e-signature step-up can check re-authentication freshness.
21. As a platform operator, I want the BFF to refuse production startup with a default or missing `SESSION_SECRET`, so that sessions cannot be forged.
22. As a platform operator, I want the same refusal when `OIDC_CLIENT_SECRET` is the shipped `mice-auth-secret`, so that the demo secret never reaches production.
23. As a platform operator, I want the BFF to refuse production startup without Secure cookies, so that Sessions are not sent over plain HTTP.
24. As a platform operator, I want the compose override for an unpublished oxen port documented, so that the data plane stays private.
25. As an auditor, I want revocation, CSRF rejection and author rejection to appear in the audit log, so that security events are traceable.

## Implementation Decisions

- **Author injection:** every non-GET request must classify as author-bearing (JSON, multipart) or match the author-free allowlist; otherwise the BFF returns `400` and nothing is proxied. Malformed JSON is rejected, not forwarded.
- **CSRF:** cookie-authenticated non-GET requests must pass an `Origin` / `Sec-Fetch-Site` same-origin check. PAT-authenticated requests are exempt. No token scheme.
- **Revocation:** a per-`iss`+`sub` "not valid before" timestamp, checked on every request against the Session's issue time. Instance admins can set it ("revoke sessions"). No session table. The same cut-off also rejects PATs created at or before it, so revocation cannot be bypassed by a long-lived token.
- **Idle timeout:** the BFF re-seals the Session cookie on activity (sliding window). The idle value is `SESSION_IDLE_SEC`, owned by PLAT-GXP; the mechanism is owned here. The absolute TTL remains.
- **PAT lifetime:** expiry is required at creation (default 90 days, max 365); a last-used timestamp is recorded; existing PATs get 365 days from migration. Expired PATs are rejected.
- **Identity key:** `iss`+`sub` everywhere (memberships, group bindings, bootstrap lists, audit actors). Email matches only when `email_verified` is true. The `@users.local` fallback never matches.
- **Migration:** a one-off, idempotent rewrite of existing stores from bare `sub` to `iss`+`sub`.
- **id_token:** validate `iss`, `aud`, `exp`, `nonce`; capture `auth_time`. No JWKS signature verification (token received directly from the token endpoint over TLS); revisit if tokens ever arrive via the front channel.
- **Startup gate:** in production, refuse to start unless `SESSION_SECRET` is set and not the dev default, `OIDC_CLIENT_SECRET` is not `mice-auth-secret`, and cookies are Secure. No reachability probe for the oxen port.
- **Out of scope here but linked:** SAML is via Keycloak brokering (BFF stays OIDC-only); SCIM is unscheduled.

## Testing Decisions

- **Good tests** assert external behavior only: HTTP status, cookies, audit events and what a fake oxen upstream received. They don't assert internal store layout.
- **Primary seam:** auth unit tests that drive the BFF app with a fake oxen upstream and a stub OIDC token endpoint. These cover the CSRF check, `400` on unclassifiable bodies, the allowlist, revocation, sliding idle timeout, PAT expiry and last-used, `iss`+`sub` keys and the store migration, bootstrap by verified email, id_token claim checks, and the startup gate (tested by calling the env-validation function, not by booting a process).
- **Secondary seam:** Playwright with Keycloak for login, revocation after an admin action, and a foreign-Origin request.
- **Prior art:** `auth/src/authz.test.ts`, `tokens.test.ts`, `audit.test.ts`; `e2e/tests/auth.spec.ts`, `cli-auth.spec.ts`, `authz.spec.ts`.

## Out of Scope

- Native SAML and SCIM.
- JWKS signature verification of the id_token.
- A server-side session table.
- Probing whether the oxen port is publicly reachable.
- E-signature step-up itself (PLAT-GXP Phase 3); this spec only captures `auth_time` for it.

## Further Notes

- Design record: `docs/adr/0001-bff-identity-trust-model.md`; plan: `plans/01-authentication.md` Phase 2.5.
- GXP Phase 1 (`GXP_STRICT`, idle timeout value) should land before W4 and cluster jobs; the idle mechanism here is a prerequisite for the timeout.
- Terms follow `GLOSSARY.md` (Principal, Session, PAT, BFF, Author injection).
