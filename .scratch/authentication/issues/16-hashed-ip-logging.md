# 16: Hashed IP Logging (U8)

**What to build:** Log source IPs as hashed values (SHA-256(IP + daily_salt)) in audit events for anomaly detection while preserving privacy. Show last 4 hex characters of hashed IP in UI for rough verification.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

## Acceptance Criteria

- [ ] Daily salt generation and rotation (midnight UTC, stored in database or config)
- [ ] Hash IP on audit event creation: SHA-256(IP + date_salt), store full hash
- [ ] Audit schema: add hashed_ip column (varchar, nullable for backward compatibility)
- [ ] Device flow approval page shows hashed IP last 4 hex chars (e.g., "Request from: ...a3:7f")
- [ ] Admin UI: Anomaly detection queries use hashed IPs (same-day pattern detection)
- [ ] Tests for salt rotation at midnight, hash consistency same-day, hash changes next day

## Context

Round 8 decision U8 restores IP logging (Round 5 had removed it) as hashed values to satisfy Part 11 §11.300(d) device checks while remaining GDPR minimization compliant. Daily salt rotation prevents long-term tracking.

Hashed IPs enable same-day anomaly detection (distributed attacks, concurrent access from multiple locations) without storing raw IPs.
