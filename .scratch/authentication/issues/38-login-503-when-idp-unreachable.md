Status: ready-for-agent

# 38: Login returns 503 when the IdP is unreachable

**Spec:** `.specs/01-authentication.md` (U3)

**Blocked by:** none

Split from issue 04. Disabled and missing users stay 403, as issue 04 specifies. Authenticated requests already return 503 from issue 19.

## What to build

When `directory.userStatus` returns `error` during login, the response is 503. The body says the IdP could not be reached. No session is created.

## In code today

`finishLogin` returns 500 for directory status `error`.

## Acceptance

- [ ] Directory status `error` on login returns 503
- [ ] No session row is created
- [ ] Directory status `disabled` and `missing` still return 403
