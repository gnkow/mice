# 01: Signing ceremony (merge approval)

**What to build:** A maintainer can electronically sign a merge with a Part 11 compliant ceremony. Fresh authentication is required per signing action. Signing refuses without MFA evidence. The exact merge content is displayed with its hash bound to the signature, and the meaning "Approved" and full name are shown.

**Blocked by:** 01 (step-up authentication), 05 (repository merge workflow)

**Status:** needs-info

**Authentication foundation:** Step-up re-authentication (< 60s freshness) is provided by 01-authentication. This ticket covers the GxP-specific signature ceremony and integration with merge approval.

## Requirements

- [ ] Fresh authentication within 60s of signing; the step-up window is never reused
- [ ] Merge content displayed with hash; content changed after display invalidates the signature
- [ ] Each signature record stores IdP authentication evidence (auth time, method and strength claims, IdP session id, token id), meaning "Approved", server time and merge content hash
- [ ] Signature stored in immudb (append-only) with PostgreSQL index
- [ ] One-time e-signature declaration is recorded before first signature
- [ ] Self-merge forbidden: signer must differ from merge author
- [ ] Self-approval forbidden: maintainer cannot approve their own submission
- [ ] Refusals are audited with reason
- [ ] No admin override for self-approval prevention
- [ ] Timestamps come only from the server clock
- [ ] Signature revocation creates linked annotation record (does not delete original)
- [ ] Bulk approval is one ceremony with one signature record per item, cap 50 items, shared ceremony id

## Implementation Notes

**Signature meaning in v1:** "Approved" only (merge approval)
**Future scope:** "Authored", "Reviewed" for other workflows

**Integration points:**
- Merge endpoint requires signature in strict mode
- Signature UI integrated into merge/PR review page
- Author identity checked against signer identity. Commit `author` is the canonical `iss|sub` from `.scratch/authentication/issues/08-human-commit-author.md`
- MFA evidence extracted from IdP claims (acr/amr)

**Storage:**
- Full signature record in immudb with `esign.created`, `esign.failed` audit events
- PostgreSQL index for query performance
- Signature linked to merge commit, repository, base/head hashes

**Related specs:**
- 01-authentication: Step-up re-authentication (user story #9)
- 04-gxp-compliance: E-signature requirements (user stories #2-4, #7-10)
- 05-repositories: Merge workflow and maintain role
