# 02: Same-origin check on cookie-authenticated writes

**What to build:** Cross-site requests riding a Session cookie are rejected, so other sites cannot act as the User. PAT-authenticated requests are exempt. No token scheme.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [x] Cookie-authenticated non-GET with a foreign `Origin` / cross-site `Sec-Fetch-Site` returns `403`
- [x] Same-origin SPA writes still succeed
- [x] PAT-authenticated writes are unaffected
- [x] GET/HEAD are unaffected
- [x] Rejection is audited
- [x] Playwright: foreign-Origin request is rejected
