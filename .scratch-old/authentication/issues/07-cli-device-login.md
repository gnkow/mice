# 07: CLI device login

**What to build:** `mice login` obtains a short-lived credential through the RFC 8628 device flow and stores it in the OS keychain per Principal, bound to the issuing remote. No PATs.

**Blocked by:** 04 (live IdP check and access states), 05 (authentication event audit and failure alerts)

**Status:** ready-for-agent

- [ ] 8 h access token; rotating refresh with reuse detection and 30-day family cap; IdP re-checked on each refresh
- [ ] Device-flow hardening: user-code entropy, rate limits, expiry, single use
- [ ] Keychain entry keyed by Principal; acting-as banner and write confirmation shown when several exist
- [ ] A second Principal logging in on the same OS user is refused (shared credentials forbidden)
- [ ] Logout ends CLI and web credentials and suspends Desktop Sessions, which resume after login within their lifetime
- [ ] Credential never outlives the Principal's IdP status
