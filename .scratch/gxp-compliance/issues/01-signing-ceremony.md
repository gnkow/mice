# 01: Signing ceremony (merge approval)

**What to build:** An approver can electronically sign a merge into a validated branch with a Part 11 compliant ceremony. Fresh authentication is required per signing action. Signing refuses without MFA evidence. The exact merge content is displayed with its hash bound to the signature, and the meaning "Approved" and full name are shown.

**Blocked by:** authentication/52 (verified signing evidence), authorization/21 (approver role), repositories/02 (merge requests)

**Status:** ready-for-agent

**Authentication foundation:** Step-up re-authentication (< 60s freshness) is provided by 01-authentication. This ticket covers the GxP-specific signature ceremony and integration with merge approval.

## Requirements

- [ ] Fresh authentication within 60s of signing; the step-up window is never reused
- [ ] Merge content displayed with hash; content changed after display invalidates the signature
- [ ] Each signature record stores IdP authentication evidence (auth time, method and strength claims, IdP session id, token id), meaning "Approved", server time and merge content hash
- [ ] Signature stored in immudb (append-only) with PostgreSQL index
- [ ] One-time e-signature declaration is recorded before first signature
- [ ] Signer holds the `approver` role and authored no commit in the merged range; one approver suffices
- [ ] Binding is source head, target head and merge-result SHA-256 manifest digest; a moved head refuses the signature
- [ ] Change-control id required
- [ ] Refusals are audited with reason
- [ ] No admin override for self-approval prevention
- [ ] Timestamps come only from the server clock
- [ ] Revocation is covered by gxp-compliance/04; the signature record by gxp-compliance/03

## Implementation Notes

**Signature meaning in v1:** "Approved" only (merge approval)
**Future scope:** "Authored", "Reviewed" for other workflows

**Integration points:**
- Merge into a validated branch requires a signature (strict mode is always on)
- Signature UI integrated into merge/PR review page
- Author identity checked against signer identity. Commit `author` is the canonical `iss|sub` from `.scratch/authentication/issues/08-human-commit-author.md`
- MFA evidence extracted from IdP claims (acr/amr)

**Storage:** see gxp-compliance/03.

**Related specs:**
- 01-authentication: Step-up re-authentication (user story #9)
- 04-gxp-compliance: E-signature requirements (user stories #2-4, #7-10)
- 05-repositories: Validated branches and merge requests
