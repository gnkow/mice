---
status: accepted
---

# The BFF trusts only verified `iss`+`sub` identity and fails closed on author injection

oxen-server has no authentication, so the BFF is the only identity boundary. We key every Principal (memberships, bootstrap admins, audit actors) on IdP `iss`+`sub`, and email only when `email_verified` is true; the synthetic `<sub>@users.local` fallback never matches anything. The BFF rejects with `400` any non-GET request whose body it cannot classify as an author-bearing shape (malformed JSON, unknown content types), unless the route is on an explicit allowlist of author-free writes (e.g. binary uploads). The `id_token` from the token endpoint is accepted without JWKS signature verification, but `iss`, `aud`, `exp` and `nonce` are checked and `auth_time` is captured for e-signature step-up.

## Considered options

- Match bootstrap admins on bare `sub` or email: simpler, but an unverified self-registered email or a reused `sub` across IdPs would grant instance admin.
- Pass unknown write shapes through unchanged: fewer rejected requests, but a client could carry its own author fields past injection and forge attribution, breaking GxP audit.
- Verify the `id_token` signature via JWKS: stronger, but redundant for a token received directly over TLS from the token endpoint (OIDC Core §3.1.3.7); revisit if tokens ever arrive via the front channel.

## Consequences

- Existing authz, bootstrap and audit stores keyed on bare `sub` need a one-off migration to `iss`+`sub`.
- New oxen write routes must be classified (author-bearing or allowlisted) before they can be proxied.
- Admin session revocation (per `iss`+`sub` not-valid-before) also rejects PATs created at or before the cut-off; PATs minted afterwards work.
