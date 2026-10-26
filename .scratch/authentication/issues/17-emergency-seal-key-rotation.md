# 17: Emergency Seal Key Rotation (U7, U16)

**What to build:** Admin command to invalidate a compromised session seal key immediately with an 8-hour grace period. Normal rotation on a 30-day schedule with 7-day overlap. Key ring storage supports multiple active keys.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

## Acceptance Criteria

- [ ] Key ring storage: database table or config (key ID, key material, valid_from, valid_until, revoked_at)
- [ ] Normal rotation: scheduled job every 30 days, new key issued, old key valid for 7 more days (overlap)
- [ ] Admin CLI command: `mice admin rotate-seal-key --emergency`
- [ ] Emergency rotation: mark current key revoked_at = now, new key issued, old key valid_until = now + 8h
- [ ] Session verification (openSession) accepts keys from valid window (not revoked, within valid_from/valid_until)
- [ ] Audit events for rotation (normal: "seal_key_rotated", emergency: "seal_key_emergency_rotation")
- [ ] Tests for normal rotation schedule, emergency rotation, grace period expiry, overlapping key validity

## Context

Round 8 decisions U7 and U16 provide both time-driven (normal) and event-driven (emergency) key rotation. If a seal key is compromised, waiting 30 days (or logging everyone out) is unacceptable. Emergency rotation invalidates the compromised key immediately while allowing a short grace period for legitimate sessions to refresh.

Session cookies sealed with revoked keys are rejected after grace period expires.
