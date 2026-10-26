# 19: Live IdP Check on All Operations (U3)

**What to build:** Remove all cache tolerance for IdP availability. Every authenticated operation requires a live IdP check. IdP unreachable = 503 for all requests (including reads). Groups checked at login, refresh, and privileged operations; ordinary reads use session-cached groups bounded by 8h session lifetime.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

## Acceptance Criteria

- [ ] Remove 5-minute IdP check throttle (SessionUser.lastIdpCheck field and throttling logic)
- [ ] IdP availability check on every authenticated request (login, token refresh, every API call)
- [ ] Return 503 "Service Unavailable" when IdP unreachable (no grace period, no stale cache)
- [ ] Groups checked at: login, token refresh, privileged operations (sign/merge/admin actions)
- [ ] Ordinary reads use session-cached groups (bounded by 8h absolute session lifetime)
- [ ] Remove AuthPolicy.requiresFreshIdpCheck flag (always true now)
- [ ] Tests for IdP outage (503 for all operations), group staleness bounds (8h max)

## Context

Round 8 decision U3 supersedes Q71's "5-minute cache for ordinary requests" with strict fail-closed behavior. Part 11 requires electronic records be attributable to individuals who are currently authorized. Any grace period or cache tolerance allows revoked users to continue operating during IdP outages.

This creates higher unavailability (dual SPOF: ImmuDB AND IdP), but prioritizes GxP correctness over availability (accepted risk per U10).
