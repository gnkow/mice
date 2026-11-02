Status: ready-for-agent

# 48: Retire personal access tokens

**Spec:** `.specs/01-authentication.md` (stories 3 and 4, Q5, Q14)

**Blocked by:** 07 (CLI must already have a short-lived credential)

## What to build

No route mints a personal access token. Bearer authentication does not accept a PAT. Users see and revoke CLI credentials from issue 07, not PATs. Existing PAT rows cannot authenticate.

## In code today

Device approval no longer calls `createPat`. `createPat` in `tokens.ts` still mints `mice_pat_` tokens, and `resolvePat` still accepts a bearer PAT. Issue 35 stores the device credential in the OS keychain and no longer writes `pat_id`. `resolveToken` still prefers `MICE_PAT` over that keychain entry. Profile UI still talks about tokens through `/auth/sessions/revoke-all`.

## Acceptance

- [ ] Token-creation routes are gone
- [ ] A bearer PAT receives 401
- [ ] Device approval no longer calls `createPat` (issue 07)
- [ ] The profile page lists and revokes CLI credentials
- [ ] Tests that used `createPat` as a session stand-in use a web session or the issue 07 credential
