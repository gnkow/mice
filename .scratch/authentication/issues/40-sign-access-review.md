Status: done

# 40: Sign the quarterly access review

**Spec:** `.specs/01-authentication.md` (S3)

**Blocked by:** none. Issue 12 stored the report.

## Outcome

`POST /auth/admin/access-review/sign` is instance-admin only. It runs the signing ceremony: a fresh authentication, MFA evidence, and the hash of the canonical stored report. The signature meaning is Reviewed, and it is written onto that report. A hash that does not match the report now stored is refused and leaves the report unsigned. The audit event `access-review.sign` records the reviewer Principal and the report id. Settings shows Sign report for an unsigned review.

## Acceptance

- [x] `POST /auth/admin/access-review/sign` runs the signing ceremony against the stored report hash
- [x] The stored report keeps the reviewer's signature record
- [x] A report that changes after it was displayed cannot be signed
- [x] The signature is audited with the reviewer Principal and the report id
- [x] The reviewer is an instance admin

## Comments

2026-11-13: Checkmate audit — **holds** (acceptance green at `POST /auth/admin/access-review/sign`; proving tests in `accessReviewRoutes.test.ts`).

**Deepen (auto-pick):** Collapse hash-gate + attach Reviewed signature into deep `applyAccessReviewSign(report, expectedHash, sign)` (in-process). Route keeps ceremony (step-up/MFA/`createSignature`); `openOrGenerateAccessReview` untouched.

**Files:** `auth/src/authentication/compliance/accessReviewSign.ts`, `auth/src/authentication/compliance/accessReviewSign.test.ts`, `auth/src/authentication/compliance/accessReviewRoutes.ts`

**Tests:** `accessReviewSign.test.ts`; regression `accessReviewRoutes.test.ts` (sign + hash-mismatch cases)
