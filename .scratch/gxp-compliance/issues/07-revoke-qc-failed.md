# 07: Revoke → QC Failed + linked record

**What to build:** Any approver can revoke one commit, several commits, or all commits of a signature. Revocation needs step-up, a reason and a change-control id. Affected commits become QC Failed. The original signature stays visible; a linked revocation record is written in immudb. Nothing is deleted.

**Blocked by:** 03, 04, 05; repositories/03

**Status:** ready-for-agent

- [ ] Revoke by commit set or whole signature
- [ ] Original signature record stays visible; a linked revocation record is written in immudb
- [ ] Affected commits become QC Failed
- [ ] Revoker need not differ from the signer or an author
- [ ] Step-up, reason and change-control id are required
- [ ] Successes and refusals are audited
