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

- **Audit:** holds — admin-only sign ceremony; hash mismatch refuses; Reviewed signature + audit.
- **Deepen (auto-pick Top):** `prepareAccessReviewDocument` owns displayed content + hash shared by admin view and sign gate; `applyAccessReviewSign` hash-checks then attaches Reviewed; route keeps ceremony; did not touch `signingRoutes`.
- **Files:** `accessReview.ts` (`prepareAccessReviewDocument` / `accessReviewAdminView`), `accessReviewSign.ts`.
- **Tests:** `accessReviewSign.test.ts`, `accessReview.test.ts` (unit); `accessReviewRoutes.test.ts` (integration).
- **Seams:** `prepareAccessReviewDocument` / `applyAccessReviewSign` (module); `POST /auth/admin/access-review/sign` (package).
