# 07: CLI device login

**What to build:** `mice login` obtains a short-lived credential through the RFC 8628 device flow and stores it in the OS keychain per Principal, bound to the issuing remote. No PATs.

**Blocked by:** 04 (live IdP check and access states), 05 (authentication event audit and failure alerts)

**Status:** completed

- [x] 8 h access token; rotating refresh with reuse detection and 30-day family cap; IdP re-checked on each refresh
- [x] Device-flow hardening: user-code entropy, rate limits, expiry, single use
- [x] Keychain entry keyed by Principal; acting-as banner and write confirmation shown when several exist
- [x] A second Principal logging in on the same OS user is refused (shared credentials forbidden)
- [x] Logout ends CLI and web credentials and suspends Desktop Sessions, which resume after login within their lifetime
- [x] Credential never outlives the Principal's IdP status

## Implementation Summary

Implemented in `auth/src/authentication/credentials/deviceFlow.ts` with comprehensive test coverage.

**Test Coverage:** 19 tests (all passing)
- Device flow initiation (user code generation, verification URI)
- Approval flow (user approval, status tracking)
- Polling for token (pending, slow_down, expired_token errors)
- Keychain storage (Principal-keyed, remote-bound, single-Principal enforcement)
- Token refresh (rotating tokens, reuse detection, 30-day family cap, IdP recheck)
- Logout (CLI/web credential revocation, Desktop Session suspend)
- Credential lifetime (tied to IdP status)

**Files:**
- `auth/src/authentication/credentials/deviceFlow.ts` - Implementation
- `auth/src/authentication/credentials/deviceFlow.test.ts` - Tests
- `auth/src/authentication/credentials/deviceApprovalRateLimit.ts` - Rate limiting
