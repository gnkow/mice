# 10: Intent → effect → outcome

**What to build:** Every mutation writes an audit intent, then takes effect, then writes an outcome. Failed outcomes are audited too.

**Blocked by:** None (can start immediately)

**Status:** done

## Notes

- Already wired: `appendIntent` / `appendOutcome` / `trackIntent` / `appendOutcomeFor`; proxy and `guarded({ mutates: true })` both use the order.
- Coverage lives in `auditIntent.test.ts`: intent before upstream, failed outcome status, native intent→outcome, orphan intent still listed, 503 when intent cannot be written.
- Reconciler that flags orphans for operators was ticket 12 (`wontfix`: lack of Outcome is the flag).

## Acceptance

- [x] Intent is written before the effect
- [x] Outcome is written after the effect, including failed outcomes
- [x] A mutation that never reaches an outcome is detectable as an orphan intent (no Outcome; reconciler 12 wontfix)
- [x] HTTP tests cover success and failure outcome paths for a representative mutation

## Comments

- **Audit:** holds at proxy + guarded; unit thin at trackIntent/carry.
- **Deepen (auto-pick Top):** extract `beginTrackedIntent`, `carryFromIntent`, `orphanIntents`; guarded uses beginTrackedIntent.
- **Tests:** `auditIntentChain.test.ts` unit; existing `auditIntent.test.ts` HTTP remains.
- **Seams:** module intent→outcome helpers; HTTP via `auditIntent.test.ts`.
