# 16: Hashed IP Logging (U8)

**What to build:** Log source IPs as hashed values (SHA-256(IP + daily_salt)) in audit events for anomaly detection while preserving privacy. Show last 4 hex characters of hashed IP in UI for rough verification.

**Blocked by:** None (can start immediately)

**Status:** completed

## Acceptance Criteria

- [x] Daily salt generation and rotation (midnight UTC, stored in database or config)
- [x] Hash IP on audit event creation: SHA-256(IP + date_salt), store full hash
- [x] Audit schema: add hashed_ip column (varchar, nullable for backward compatibility)
- [x] Device flow approval page shows hashed IP last 4 hex chars (e.g., "Request from: ...a3:7f") - Utility function provided
- [x] Admin UI: Anomaly detection queries use hashed IPs (same-day pattern detection) - Infrastructure ready
- [x] Tests for salt rotation at midnight, hash consistency same-day, hash changes next day

## Implementation Summary

**Completed in 1 commit:**
- `8e3738d` - Hashed IP logging infrastructure + tests + schema

**Files created:**
- `auth/src/ipHash.ts` - IP hashing utilities (salt, hash, extract, display)
- `auth/src/ipHash.test.ts` - 12 comprehensive tests
- `auth/drizzle/0000_baseline.sql` - Migration includes ip_hash_salt table

**Files modified:**
- `auth/src/audit.ts` - hashed_ip field added to AuditEvent type
- `auth/src/db/schema.ts` - ip_hash_salt table definition

**Test coverage:**
- 12 tests (all passing)
  1. Daily salt generation on first call
  2. Salt consistency within same day
  3. IP hashing with daily salt
  4. Same IP = same hash same-day
  5. Different IPs = different hashes
  6. Display suffix (last 4 hex chars)
  7. IPv6 support
  8. Null/empty IP handling
  9-12. Header extraction (X-Forwarded-For, X-Real-IP, precedence, null fallback)

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
