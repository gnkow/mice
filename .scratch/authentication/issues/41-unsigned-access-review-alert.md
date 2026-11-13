Status: done

# 41: Alert when an access review is unsigned for 14 days

**Spec:** `.specs/01-authentication.md` (S3)

**Blocked by:** none. Issues 12 and 40 are done.

## What to build

A scheduled check finds a quarterly access review that is still unsigned 14 days after it was generated and alerts security admins. A signed report produces no alert. The check runs at least daily.

## In code today

`GET /auth/admin/access-review/overdue` lists unsigned reports whose `generatedAt` is at least 14 days ago. Settings shows that list in the Access Review section. `startAccessReviewAlertSchedule` runs at boot and once a day, and sends each instance admin a security notification naming the quarter and the report id. A signed report is left out of both.

## Acceptance

- [x] A stored report with no signature, older than 14 days, alerts security admins with the quarter and the report id
- [x] A signed report does not alert
- [x] The check runs on a daily schedule

## Comments

- **Audit:** holds — unsigned >14d alerts admins; signed skipped; daily schedule.
- **Deepen (auto-pick Top):** `accessReviewAlertCandidateFromRow` maps stored rows once; `listOverdueAccessReviews` and schedule `tick` both use it with `decideUnsignedAccessReviewAlert` (14-day threshold + summary).
- **Files:** `accessReviewAlert.ts`.
- **Tests:** `accessReviewAlert.test.ts` (unit); `accessReviewRoutes.test.ts` overdue + notify (integration).
- **Seams:** `decideUnsignedAccessReviewAlert` / `accessReviewAlertCandidateFromRow` (module); overdue route + schedule (package).

2026-11-13: deep-api Deepen (holds) — auto-picked Top architecture recommendation; unit+integration strengthened at ticket seams; Status remains done.

2026-11-13: /deep-ui skipped — no-ui (API/CLI/boot acceptance only). User acknowledged skip on authentication deep-ui board.
