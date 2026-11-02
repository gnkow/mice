Status: ready-for-agent

# 40: Sign the quarterly access review

**Spec:** `.specs/01-authentication.md` (S3)

**Blocked by:** 12 (the stored report that gets signed)

## What to build

A named reviewer signs the stored quarterly access review with the signing ceremony from issue 09. The signature record is attached to that report. One signature covers that report only.

## In code today

`AccessReviewReport` has an optional `reviewerSignature` field. No route calls the signing ceremony, and the report is not stored yet (issue 12).

## Acceptance

- [ ] `POST /auth/admin/access-review/sign` runs the signing ceremony against the stored report hash
- [ ] The stored report keeps the reviewer's signature record
- [ ] A report that changes after it was displayed cannot be signed
- [ ] The signature is audited with the reviewer Principal and the report id
