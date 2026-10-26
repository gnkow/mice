# 24: Rate Limiter Fail-Closed (U22)

**What to build:** Shared rate limiters (across BFF instances) for authentication endpoints. Rate-limit counter store (Redis or Postgres) unreachable = 503 (fail-closed, not fail-open). Per-IP and per-Principal limits.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

## Acceptance Criteria

- [ ] Rate limit counter storage shared across BFF instances (Redis preferred, Postgres fallback)
- [ ] Per-IP limits: login callback (10/min), device flow initiation (5/min), token refresh (20/min)
- [ ] Per-Principal limits: device approval (5/10min per U15), token minting (10/hour)
- [ ] Fail-closed: if counter store unreachable, return 503 "Service Unavailable" (not allow unlimited)
- [ ] Alert on rate limit store outage (logging + metrics)
- [ ] Rate limit exceeded returns 429 "Too Many Requests" with Retry-After header
- [ ] Tests for rate limiting (per-IP, per-Principal), fail-closed behavior (store down = 503), cross-instance enforcement

## Context

Round 8 decision U22 clarifies that strict mode is ALWAYS ON (not a switch), so rate limiters must fail-closed always. Part 11 §11.10 requires "authority checks." Allowing unlimited requests when the rate limiter is down enables credential stuffing attacks that bypass account lockout.

Consistent with U10 (no break-glass) - correctness over availability.
