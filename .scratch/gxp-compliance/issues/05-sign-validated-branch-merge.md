# 05: Sign merge into validated branch

**What to build:** An eligible approver electronically signs a merge into a validated branch. Fresh step-up authentication is required. The signature meaning is "Approved". Binding is source head, target head and merge-result SHA-256 manifest digest; a moved head refuses the signature. The signer must hold the `approver` role and must not have authored any commit in the merged range. One approver suffices. Change-control id is required. Refusals are audited.

**Blocked by:** 01, 02, 04; authentication/52; authorization/21; repositories/02

**Status:** ready-for-agent

- [ ] Fresh step-up authentication is required per signing action; session cookie alone is insufficient
- [ ] Signer holds `approver` and authored no commit in the merged range; one approver suffices
- [ ] Binding is source head, target head and merge-result manifest digest; moved heads refuse the signature
- [ ] Meaning "Approved", printed name and server time are recorded
- [ ] Change-control id is required and validated
- [ ] Successful signature completes the merge into the validated branch
- [ ] Refusals are audited with reason; no admin override of self-approval prevention
- [ ] Timestamps come only from the server clock
