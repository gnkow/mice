Status: ready-for-agent

# 48: Retire personal access tokens

**Spec:** `.specs/01-authentication.md` (stories 3 and 4, Q5, Q14)

**Blocked by:** 07 (CLI must already have a short-lived credential)

## What to build

No route mints a personal access token. Bearer authentication does not accept a PAT. Users see and revoke CLI credentials from issue 07, not PATs. Existing PAT rows cannot authenticate.

## In code today

`createPat` in `tokens.ts` is the mint path. `cliDevice.ts` calls it for device approval. `resolvePat` accepts a bearer PAT on authenticated routes. Profile UI still talks about tokens through `/auth/sessions/revoke-all`.

## Acceptance

- [ ] Token-creation routes are gone
- [ ] A bearer PAT receives 401
- [ ] Device approval no longer calls `createPat` (issue 07)
- [ ] The profile page lists and revokes CLI credentials
- [ ] Tests that used `createPat` as a session stand-in use a web session or the issue 07 credential
