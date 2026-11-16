# 15: Restore test before first regulated action

**What to build:** A restore test must pass before the first regulated action (first validated-branch merge or signature). Until then those actions are refused.

**Blocked by:** 14, 05

**Status:** done

- [x] First validated-branch merge or signature is refused until a restore test has passed
- [x] Passing restore test is recorded and visible to operators
- [x] Subsequent regulated actions proceed once the gate has passed

## Comments

**Deep-api Close (2026-11-16):** Seams `decideRestoreTestGate` + `recordRestoreTestPassed` + gate in `completeSignedMerge`; admin `POST/GET /auth/admin/restore-test`. Unit: `restoreTestGate.test.ts`. HTTP: complete refuses with `restore_test_required` until unlock (`completeSignedMerge.test.ts`).
