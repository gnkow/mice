Status: ready-for-agent

# 46: IdP outage incident record

**Spec:** `.specs/01-authentication.md` (R7, T5)

**Blocked by:** none

Split from issue 11. Login and authenticated requests already fail closed (issues 19 and 38).

## What to build

When the IdP or directory is unreachable, Mice records an incident that points at the paper procedure in the validation pack. The incident includes the start time, the failing check, and the request id of the first failure in that outage. A later success closes the incident. There is no local emergency account and no grace login.

## In code today

Login returns 500 for directory status `error` (issue 38 changes that to 503). Authenticated requests return 503 from `verifyIdpAccess`. Those failures are logged. No incident row is written, and the paper procedure is not in the repo.

## Acceptance

- [ ] The first 503 caused by an unreachable IdP opens one incident for that outage
- [ ] The incident references the paper procedure
- [ ] Further 503s in the same outage do not open a second incident
- [ ] The next successful IdP check closes the incident
- [ ] No route creates a local account because the IdP is down
