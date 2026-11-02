Status: done

# 05: Authentication event audit and failure alerts

**Spec:** `.specs/01-authentication.md` (T7, S2)

Hashed IPs on these events are issue 44. U8 supersedes the earlier "store no IP" rule.

## Outcome

Login, refresh, logout, step-up, failure, and revocation append an audit entry with request id and Principal. Tokens, cookies, and codes are redacted. Five failed or refused attempts for one Principal inside 10 minutes raise an in-process security alert.

## Acceptance

- [x] Each listed event type produces an audit entry that can be queried by Principal
- [x] A redaction test fails if a token, cookie, or code reaches logs or audit
- [x] Failed attempts yield the same external error shape
- [x] An alert fires after 5 failed or refused attempts for one Principal in 10 minutes

## Code

- `auth/src/authentication/audit/authEvents.ts`
- `auth/src/authentication/audit/authEvents.test.ts`
