Status: done

# 34: Scheduled seal-key rotation

**Spec:** `.specs/01-authentication.md` (U7, U16)

Split from issue 17. Manual normal and emergency rotation already work.

## Outcome

Boot starts a normal-rotation schedule after the bootstrap key exists. A tick rotates when the current key's `validFrom` is at least 30 days ago, so a restart does not reset the wait. The tick uses `normalRotation`, which leaves the previous key valid for 7 days, and writes `seal_key.rotated` with the process as the actor. Emergency rotation stays an admin action.

## Acceptance

- [x] The process starts a 30-day normal-rotation schedule
- [x] A scheduled run creates a new primary key and leaves the previous key valid for 7 days
- [x] The scheduled run writes the same audit event as a manual normal rotation
- [x] Emergency rotation still happens only when an admin invokes it

## Code

- `auth/src/authentication/session/sealKeyRotationSchedule.ts`
- `auth/src/boot.ts`
