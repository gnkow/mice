Status: ready-for-agent

# 41: Alert when an access review is unsigned for 14 days

**Spec:** `.specs/01-authentication.md` (S3)

**Blocked by:** 12 (stored reports) and 40 (the signature that clears the alert)

## What to build

A scheduled check finds a quarterly access review that is still unsigned 14 days after it was generated and alerts security admins. A signed report produces no alert. The check runs at least daily.

## In code today

Reports are returned from the generate route and not stored. Nothing scans report age.

## Acceptance

- [ ] A stored report with no signature, older than 14 days, alerts security admins with the quarter and the report id
- [ ] A signed report does not alert
- [ ] The check runs on a daily schedule
