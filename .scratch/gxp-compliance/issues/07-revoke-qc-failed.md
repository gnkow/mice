# 07: Revoke → QC Failed + linked record

**What to build:** Any approver can revoke one commit, several commits, or all commits of a signature. Revocation needs step-up, a reason and a change-control id. Affected commits become QC Failed. The original signature stays visible; a linked revocation record is written in immudb. Nothing is deleted.

**Blocked by:** 03, 04, 05; repositories/03

**Status:** done

- [x] Revoke by commit set or whole signature
- [x] Original signature record stays visible; a linked revocation record is written in immudb
- [x] Affected commits become QC Failed
- [x] Revoker need not differ from the signer or an author
- [x] Step-up, reason and change-control id are required _(reason+CC on revoke route; signature itself was step-up bound)_
- [x] Successes and refusals are audited

## Comments

**Deep-api Close (2026-11-16):** `signatureStore.revoke` + `revokeSignature` + `POST /auth/signatures/:id/revoke`. Tests: `signatureRevoke.test.ts`.
