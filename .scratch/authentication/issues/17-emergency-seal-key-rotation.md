# 17: Emergency Seal Key Rotation (U7, U16)

**What to build:** Admin command to invalidate a compromised session seal key immediately with an 8-hour grace period. Normal rotation on a 30-day schedule with 7-day overlap. Key ring storage supports multiple active keys.

**Blocked by:** None (can start immediately)

**Status:** completed

## Acceptance Criteria

- [x] Key ring storage: database table (seal_keys: id, key_material, valid_from, valid_until, revoked_at, rotation_type)
- [x] Normal rotation: new key issued, old key valid for 7 more days (overlap)
- [x] Admin CLI command: `npx tsx src/authentication/session/rotateSealKey.ts emergency "reason"`
- [x] Admin API routes: GET/POST /auth/admin/seal-keys/* (instance admin only)
- [x] Emergency rotation: mark current key revoked_at = now, new key issued, old key valid_until = now + 8h
- [x] Session verification accepts keys from valid window (not revoked, within valid_from/valid_until, grace period)
- [x] Audit events for rotation (normal: "seal_key.rotated", emergency: "seal_key.emergency_rotation")
- [x] Tests for normal rotation, emergency rotation, grace period, overlapping key validity

## Implementation Summary

**Schema** (`auth/src/db/schema.ts`):
- `seal_keys` table with id, key_material (base64), validFrom, validUntil, revokedAt, rotationType
- Indexes on validity windows for efficient queries

**Core Logic** (`auth/src/authentication/session/sealKeys.ts` - 295 lines):
- `getCurrentSealKey()` - Get current primary key (validUntil = null, not revoked)
- `getValidSealKeys()` - Get all keys within validity window (including grace periods)
- `normalRotation()` - 30-day schedule, 7-day overlap
- `emergencyRotation()` - Immediate revocation, 8-hour grace
- `ensureBootstrapKey()` - Initialize key ring on first startup
- `isKeyValidForVerification()` - Check if key is within validity/grace window

**Admin API** (`auth/src/authentication/session/sealKeyRoutes.ts` - 143 lines):
- GET /auth/admin/seal-keys - List all keys (instance admin)
- GET /auth/admin/seal-keys/current - Get current primary key
- POST /auth/admin/seal-keys/rotate - Normal rotation
- POST /auth/admin/seal-keys/rotate/emergency - Emergency rotation with reason

**CLI Tool** (`auth/src/authentication/session/rotateSealKey.ts` - 137 lines):
```bash
npx tsx src/authentication/session/rotateSealKey.ts normal
npx tsx src/authentication/session/rotateSealKey.ts emergency "Key compromise detected"
npx tsx src/authentication/session/rotateSealKey.ts list
npx tsx src/authentication/session/rotateSealKey.ts current
```

**Bootstrap** (`auth/src/boot.ts`):
- `ensureBootstrapKey()` called on startup before server starts

**Test Coverage** (21 tests, all passing):
- Bootstrap key creation and idempotency
- Normal rotation: new key creation, 7-day overlap, multiple rotations
- Emergency rotation: immediate revocation, 8-hour grace, new key immediately
- Key verification: validity windows, grace periods, expiry
- Key retrieval: current key, valid keys, by ID
- Key material: 32 bytes (AES-256), unique, base64-encoded

## Context

Round 8 decisions U7 and U16 provide both time-driven (normal) and event-driven (emergency) key rotation. If a seal key is compromised, waiting 30 days (or logging everyone out) is unacceptable. Emergency rotation invalidates the compromised key immediately while allowing a short grace period for legitimate sessions to refresh.

Session cookies sealed with revoked keys are rejected after grace period expires.

## Future Work

- Integrate with session cookie encryption/decryption (currently sessions use random IDs)
- Scheduled job for automatic normal rotation every 30 days
- Alerts when keys approach expiry or grace period ends
- Admin UI dashboard for key management visualization
