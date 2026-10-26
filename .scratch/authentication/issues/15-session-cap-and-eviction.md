# 15: Session Cap and Eviction (U4)

**What to build:** Limit each Principal to 5 concurrent web sessions. When the cap is exceeded, evict the oldest session (by sessionStart timestamp). "My sessions" UI (already implemented) allows users to manually revoke sessions.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

## Acceptance Criteria

- [ ] Database query: count active sessions per Principal (by iss+sub or principalId)
- [ ] Session creation checks cap before issuing new session
- [ ] Oldest-session eviction: SELECT session with MIN(sessionStart), DELETE, audit event
- [ ] Audit event for automatic session eviction (include evicted session ID, reason: "cap exceeded")
- [ ] Error message when manual session creation fails due to cap (user sees count and cap)
- [ ] Tests for cap enforcement (6th session evicts oldest), eviction audit, manual revocation via UI

## Context

Round 8 decision U4 caps sessions at 5 per Principal to reduce stolen-cookie surface. Part 11 §11.300(b) requires authority checks; unlimited sessions create enforcement problems.

The "my sessions" UI already exists (user can view and revoke their own sessions). This ticket adds automatic enforcement of the 5-session cap with oldest-session eviction.
