Status: ready-for-agent

# 37: Re-check groups on privileged operations

**Spec:** `.specs/01-authentication.md` (U3, U18)

**Blocked by:** none

Split from issue 19. Per-request user-status checks stay in issue 19.

## What to build

Sign, merge, and admin actions fetch the caller's groups from the directory before the authorization decision. A group removed in the IdP is absent for that action. A group added in the IdP is also absent until the user refreshes the session or logs in again. Ordinary reads keep using the groups stored on the session.

## In code today

`verifyIdpAccess` checks enabled or disabled only. `groups` on the session are whatever login stored. No sign, merge, or admin handler calls `getUserGroups`.

## Acceptance

- [ ] Sign, merge, and admin fetch groups from the directory and authorize with that list
- [ ] A group removed in the IdP cannot satisfy a sign, merge, or admin grant on the next such call
- [ ] A group added in the IdP does not grant anything on an ordinary read
- [ ] A directory failure on those actions returns 503
