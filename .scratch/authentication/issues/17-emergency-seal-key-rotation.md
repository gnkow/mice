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
- `auth/src/authentication/session/sealKeyRoutes.test.ts`
- `auth/src/authentication/session/rotateSealKey.ts`
- `web/src/components/SealKeyRotationSection.tsx`
- `auth/src/boot.ts` (`ensureBootstrapKey`)

## Comments

2026-11-13 — Checkmate audit: **holds** (acceptance covered by `sealKeys.test.ts`).

**Deepen (auto-picked):** Unify normal/emergency rotation behind one `performRotation` + `RETIREMENT` policy table in `sealKeys.ts` (shared retire-and-issue; `toSealKey` mapping). `emergencyRotation(at)` now accepts an injected clock like `normalRotation`. Public seams unchanged for routes/CLI.

**deep-api Deepen (2026-11-13):** Auto-picked Top — `rotateSealKeyWithAudit` + `presentSealKey` own audit and public key views; routes/CLI call that seam (fixed admin gate to `isInstanceAdmin` instead of invalid `capability: 'isInstanceAdmin'`). Integration: `sealKeyRoutes.test.ts` covers normal/emergency rotate HTTP + list without key material.

**Seams:** module `rotateSealKeyWithAudit` / `presentSealKey`; HTTP `/auth/admin/seal-keys`, `/rotate`, `/rotate/emergency`.

**Files:** `sealKeys.ts`, `sealKeys.test.ts`, `sealKeyRoutes.ts`, `sealKeyRoutes.test.ts`, `rotateSealKey.ts`

2026-11-13 — **deep-ui Deepen** (holds): Settings `SealKeyRotationSection` — flash `role=alert`/`role=status`, loading+Try again, empty key-ring state, dropped custom alert/card chrome for ns-settings. E2E: `e2e/tests/settings-auth-admin.spec.ts` · Seal keys.
