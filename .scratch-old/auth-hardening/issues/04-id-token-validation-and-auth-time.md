# 04: id_token validation and `auth_time` capture

**What to build:** Login rejects an id_token with a wrong issuer, audience, expiry or nonce, and the Session records `auth_time` for later e-signature step-up. No JWKS signature check (token comes directly from the token endpoint over TLS).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [x] Wrong `iss`, wrong `aud`, expired `exp` and mismatched `nonce` each fail login
- [x] A valid token logs in and the Session carries `auth_time`
- [x] Missing `auth_time` is tolerated and recorded as absent
