---
status: proposed
supersedes: 0001
---

# The BFF always verifies the `id_token` signature

## Context

ADR 0001 accepted the `id_token` without JWKS signature verification, because it arrives over TLS straight from the token endpoint (OIDC Core §3.1.3.7). The respec interview (00 Q18, 01 Q9) rejected that: in a GxP system the identity in every audit event and e-signature must rest on a cryptographic check, not on transport alone. The rest of ADR 0001 (verified `iss`+`sub` keys, email only when `email_verified`, fail-closed author injection) is unchanged.

## Decision

- The BFF verifies the `id_token` signature against the issuer's JWKS on every login and step-up, in addition to `iss`, `aud`, `exp`, `nonce` and `auth_time`.
- The issuer must be `https`. Unknown `kid` triggers one JWKS refetch; failure rejects the login.
- Only asymmetric algorithms on an allowlist are accepted; `none` and HMAC are refused.
- The `GXP_STRICT` values default to on (see the strict-always-on ADR).
- ADR 0001 is marked `superseded by` this ADR when accepted.

## Consequences

- The BFF depends on JWKS availability at login time; a cached key set bounds this and an IdP outage already blocks login.
- Key rotation at the IdP is handled by refetch, with no manual step.
- Tests need an in-process fake IdP that signs tokens.
- The front channel is no longer a reason to revisit the decision.

## Alternatives rejected

- Keep ADR 0001 (TLS-only trust): redundant by the spec, but cannot be defended to an inspector as a verified identity.
- Verify only in strict mode: strict is always on, so this collapses into the decision.
