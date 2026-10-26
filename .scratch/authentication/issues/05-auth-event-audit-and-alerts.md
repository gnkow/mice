# 05: Authentication event audit and failure alerts

**What to build:** Every authentication event is attributable. Login, refresh, logout, step-up, failure and revocation are audited with request id and Principal, never with IPs, tokens, cookies or codes. Errors are uniform and constant-time. Five failures in 10 minutes alert security admins.

**Blocked by:** 03 (session lifecycle and CSRF), 04 (live IdP check and access states)

**Status:** resolved

- [x] Each listed event type produces an audit entry; an inspector query by Principal and month returns all logins
- [x] A redaction test fails if any token, cookie or code reaches logs or audit
- [x] No IP address is stored in any field
- [x] Failed attempts yield identical external responses and timing
- [x] Alert fires after 5 failed or refused attempts for one Principal in 10 minutes
