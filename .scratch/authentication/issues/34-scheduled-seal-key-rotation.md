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

## Comments

- **Audit:** holds — acceptance covered by `sealKeyRotationSchedule.test.ts` (DB path); boot still only calls `startSealKeyRotationSchedule()` after bootstrap.
- **Deepen (auto-pick Top):** Due-check + rotate + audit live in `isSealKeyRotationDue` / `runScheduledSealKeyRotation`; `startSealKeyRotationSchedule` owns the timer and delegates tick. Collaborators (`now`, `getCurrent`, `rotate`, `audit`) are injectable via `SealKeyRotationScheduleDeps` — does not rewrite `sealKeys` core (ticket 17).
- **Integration:** injectable-deps suite in `sealKeyRotationSchedule.test.ts` — `tick` invokes `rotate` when due and skips when young; DB suite still proves 30-day / 7-day / audit with live seal keys.
- **Files:** `auth/src/authentication/session/sealKeyRotationSchedule.ts`, `sealKeyRotationSchedule.test.ts`

2026-11-13: deep-api Deepen (holds) — auto-picked Top architecture recommendation; unit+integration strengthened at ticket seams; Status remains done.

2026-11-13: /deep-ui skipped — no-ui (API/CLI/boot acceptance only). User acknowledged skip on authentication deep-ui board.

2026-11-13: **/deep-ui Deepen (reclassified UI)** — supersedes prior no-ui skip. No schedule next-run/last-tick API; UI derives status from current key `validFrom` via `decideSealKeyScheduleStatus` (`web/src/lib/sealKeySchedule.ts`). `SealKeyRotationSection` accessible `role="status"` region shows 30-day schedule basis + next eligible. E2E: `e2e/tests/seal-key-rotation-schedule.spec.ts`. No commit/push.
