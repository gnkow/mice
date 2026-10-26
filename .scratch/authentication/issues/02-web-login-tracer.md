# 02: Web login tracer

**What to build:** A user logs in through the IdP and gets an opaque server-side Session cookie. The BFF resolves a Principal keyed by iss+sub and `/me` returns it. Postgres holds the single-use login state (TTL 10 min). The ID-token signature is verified on every request with JWKS fetched each time. A missing name claim refuses login.

**Blocked by:** 01 (test IdP harness and clock control)

**Status:** ready-for-agent

- [ ] Login, callback, `/me` work end to end against the test IdP
- [ ] Login state is single-use; replay, expiry and tampering are rejected
- [ ] Forged or wrongly signed tokens are rejected; 5-minute clock leeway applies to token validity only
- [ ] Cookie is `__Host-`, Secure, SameSite=Lax; id is opaque; Session row is server side
- [ ] Empty name claim refuses login
- [ ] Principal identity uses canonical iss, internal id and a unique iss+sub key
