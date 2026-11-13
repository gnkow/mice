Status: done

# 12: Quarterly access review report

**Spec:** `.specs/01-authentication.md` (S3)

**Blocked by:** none

Signing the report is issue 40. The 14-day alert is issue 41. Recovery tokens are issue 39.

## Outcome

An admin generates one report per quarter. It lists every Principal with namespace roles, instance grants, and last login. Last login is the web Session start, stored on the Principal in milliseconds. The report is stored by quarter. Generating that quarter again returns the stored document and does not add Principals who appeared later. `GET /auth/admin/access-review/:quarter` opens the stored report. The settings page can open it. Generation is audited as `access-review.generate`. Opening a stored report, including a second generate, is audited as `access-review.read`.

## Acceptance

- [x] The stored report includes every Principal, roles, grants, and last login
- [x] Generating a quarter again returns the stored report for that quarter
- [x] An admin can open a previously generated report from the settings page
- [x] Generation and reads of the stored report are audited

## Code

- `auth/src/authentication/compliance/accessReview.ts`
- `auth/src/authentication/compliance/accessReviewRoutes.ts`
- `auth/src/authentication/session/session.ts` (`sealSession` records last login)
- `auth/drizzle/0004_principal_last_login.sql`
- `auth/drizzle/0005_access_review_reports.sql`
- `web/src/components/AccessReviewSection.tsx`

## Comments

2026-11-13 — Checkmate audit: **holds** (store-once quarter, principals/roles/grants/last login, audits via `accessReviewRoutes.test.ts` + `accessReview.test.ts`).

**Deepen (auto-picked):** Pull store-once generate/read into deep `openOrGenerateAccessReview(quarter)` (collect + findStored + store ports). Routes are HTTP/audit adapters over that seam.

2026-11-13 — **Deepen #2 (auto-picked):** Collapse duplicate admin `report` + `contentHash` assembly into `accessReviewAdminView(report)`. Generate/GET routes return that view; hash of `displayedAccessReview` stays behind the seam.
**Seams:** `accessReview.ts` (`accessReviewAdminView`, `openOrGenerateAccessReview`); HTTP/audit in `accessReviewRoutes.ts`.
**Tests:** `accessReview.test.ts` (unit), `accessReviewRoutes.test.ts` (integ).

2026-11-13: deep-api Deepen (holds) — auto-picked Top architecture recommendation; unit+integration strengthened at ticket seams; Status remains done.

2026-11-13 — **deep-ui Deepen** (holds): Settings `AccessReviewSection` — empty-state before open, submit loading/`role=alert`/`role=status` feedback, ns-settings chrome (kept signature name-display). E2E: `e2e/tests/settings-auth-admin.spec.ts` · Access review (generate).
