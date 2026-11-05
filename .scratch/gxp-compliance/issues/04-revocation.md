# 04: Revocation

**What to build:** Any approver can revoke one commit, several commits, or all commits of a signature. Revocation needs step-up, a reason and a change-control id. Affected commits become QC Failed. Revoking a merge request before it merges blocks the merge. A QC Failed commit can return to QC Passed only through a new signature. Nothing is deleted and nothing propagates to other commits.

**Spec:** `.specs/04-gxp-compliance.md`

**Blocked by:** 01, repositories/03

**Status:** ready-for-agent

## Acceptance

- [ ] Revoke by commit set or whole signature; the original signature record stays visible and a linked revocation record is written (immudb)
- [ ] The revoker need not differ from the signer or an author
- [ ] The Owners and the original signer are notified
- [ ] Revoking before the merge blocks the merge
- [ ] Restoring QC Passed requires a new signature; the history shows both
- [ ] Revoking the signature fails its commits, including the merge commit; revoking individual commits leaves the merge commit's status unchanged
- [ ] Refusals and successes are audited
