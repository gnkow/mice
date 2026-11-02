Status: ready-for-agent

# 39: Persist and consume the recovery token

**Spec:** `.specs/01-authentication.md` (Q67)

**Blocked by:** none

Split from the old access-review issue. The quarterly report is issue 12.

## What to build

Two different admins issue one recovery token. It is stored, single-use, and expires one hour after the second admin approves. Presenting the token is audited and performs the documented recovery action once. A second presentation fails.

## In code today

`POST /auth/admin/recovery-token/request` and `.../approve` keep the pending request in a process-local `Map`. Approve returns a token object that is not stored. `POST /auth/admin/recovery-token/validate` returns 501. The settings page can request and approve.

## Acceptance

- [ ] The pending request and the issued token are stored in Postgres
- [ ] The approving admin must differ from the requesting admin
- [ ] The token expires 60 minutes after approval and cannot be used twice
- [ ] Validate consumes a live token, audits the use, and rejects an expired or unknown token
- [ ] A restart of the BFF does not drop a token that is still inside the hour
