Status: done

# 17: Seal key rotation

**Spec:** `.specs/01-authentication.md` (U7, U16)

The unattended 30-day schedule is issue 34. Cookie unseal during overlap is issue 03.

## Outcome

`seal_keys` holds key material, validity, revocation time, and rotation type. Normal rotation issues a new primary key and leaves the previous key valid for 7 days. Emergency rotation revokes the current key immediately and leaves it valid for 8 hours. Admins can list keys and rotate from the API, the settings page, and `rotateSealKey.ts`. Rotation is audited.

## Acceptance

- [x] The key ring is stored in `seal_keys`
- [x] Normal rotation keeps the previous key valid for 7 days
- [x] Emergency rotation revokes the current key and keeps it valid for 8 hours
- [x] Verification accepts a key that is inside its validity window
- [x] Normal and emergency rotations write audit events
- [x] Instance admins can rotate from the API and the CLI script

## Code

- `auth/src/authentication/session/sealKeys.ts`
- `auth/src/authentication/session/sealKeyRoutes.ts`
- `auth/src/authentication/session/rotateSealKey.ts`
- `web/src/components/SealKeyRotationSection.tsx`
- `auth/src/boot.ts` (`ensureBootstrapKey`)

## Comments

2026-11-13 — Checkmate audit: **holds** (acceptance covered by `sealKeys.test.ts`).

**Deepen (auto-picked):** Unify normal/emergency rotation behind one `performRotation` + `RETIREMENT` policy table in `sealKeys.ts` (shared retire-and-issue; `toSealKey` mapping). `emergencyRotation(at)` now accepts an injected clock like `normalRotation`. Public seams unchanged for routes/CLI.

**Files:** `auth/src/authentication/session/sealKeys.ts`, `sealKeys.test.ts`
