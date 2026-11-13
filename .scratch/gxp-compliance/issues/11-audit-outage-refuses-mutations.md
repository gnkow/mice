# 11: Audit outage refuses mutations

**What to build:** When audit is unavailable every mutation is refused and reads continue. There is no outbox and no held output. Users see "audit unavailable, nothing was saved" and the client keeps local work. A Job finishing during an outage does not persist its result.

**Blocked by:** 10

**Status:** done

## Notes

- Shared copy: `AUDIT_UNAVAILABLE_MESSAGE` (`audit unavailable, nothing was saved`) on proxy and native `guarded` intent failure.
- No `finalizing` job status; no outbox / held-output / audit-pending paths in code.
- CLI `completeCliJob` and server-side result commit require an Intent before persisting `result_commit`; audit outage → 503 / job failed with no result.

## Acceptance

- [x] Audit outage: mutations return "audit unavailable, nothing was saved"; reads work
- [x] No outbox and no held-output path remain
- [x] The "finalizing" state and audit-pending header handling are removed
- [x] A Job finishing during an outage does not persist its result and reports failure

## Comments

- **Audit:** holds (proxy + guarded + jobs Intent-before-result_commit). Unit thin at jobs seam; integration thin for jobs outage.
- **Deepen (auto-pick Top):** extract `appendJobResultCommitIntent` in `jobs.ts`; both `completeCliJob` and `executeJob` use it.
- **Tests:** `jobsAuditOutage.test.ts` — helper unit (ok + throw) + `completeCliJob` refuses with `AUDIT_UNAVAILABLE_MESSAGE` / 503 and leaves `result_commit` null.
- **Seams:** module `appendJobResultCommitIntent`; package `completeCliJob` under `useAuditLedger` fault injection.
