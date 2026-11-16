# 05: Sign merge into validated branch

**What to build:** An eligible approver electronically signs a merge into a validated branch. Fresh step-up authentication is required. The signature meaning is "Approved". Binding is source head, target head and merge-result SHA-256 manifest digest; a moved head refuses the signature. The signer must hold the `approver` role and must not have authored any commit in the merged range. One approver suffices. Change-control id is required. Refusals are audited.

**Blocked by:** 01, 02, 04; authentication/52; authorization/21; repositories/02

**Status:** done

- [x] Fresh step-up authentication is required per signing action; session cookie alone is insufficient _(signature created via `/auth/sign/execute` step-up; complete consumes that bound id)_
- [x] Signer holds `approver` and authored no commit in the merged range; one approver suffices
- [x] Binding is source head, target head and merge-result manifest digest; moved heads refuse the signature
- [x] Meaning "Approved", printed name and server time are recorded
- [x] Change-control id is required and validated
- [x] Successful signature completes the merge into the validated branch
- [x] Refusals are audited with reason; no admin override of self-approval prevention
- [x] Timestamps come only from the server clock

## Comments

**Deep-api Close (2026-11-16):** Seams `decideSignedMergeComplete` + `completeSignedMerge` + `POST /auth/merge-requests/:id/complete`. Approver + self-merge + head/binding/CC/meaning gates; consume signature → oxen merge (injectable) → MR merged + QC Passed. Unit: `signedMergeComplete.test.ts`. HTTP: `completeSignedMerge.test.ts`.
