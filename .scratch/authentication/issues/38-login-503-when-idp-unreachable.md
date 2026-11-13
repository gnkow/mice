Status: done

# 38: Login returns 503 when the IdP is unreachable

**Spec:** `.specs/01-authentication.md` (U3)

**Blocked by:** none

Split from issue 04. Disabled and missing users stay 403, as issue 04 specifies. Authenticated requests already return 503 from issue 19.

## What to build

When `directory.userStatus` returns `error` during login, the response is 503. The body says the IdP could not be reached. No session is created.

## Outcome

`finishLogin` returns 503 when `directory.userStatus` is `error`, with the unreachable message. The callback writes a Session only after a successful login, and the unreachable path leaves `web_sessions` empty. Disabled and missing stay 403. Provider failures stay 500. Authenticated-request 503 is unchanged (issue 19).

## Acceptance

- [x] Directory status `error` on login returns 503
- [x] No session row is created
- [x] Directory status `disabled` and `missing` still return 403

## Comments

- **Audit:** holds — directory `error` → 503, no Session; disabled/missing stay 403 (ticket 04).
- **Deepen (auto-pick Top, alongside `loginDirectoryStatus`, no fight with 04):** decision now owns `idpCheck: 'reachable' | 'unreachable'` so `finishLogin` records outage vs reachable without special-casing `httpStatus === 503`. Ticket 04’s 403 messages / `recordDisabled` unchanged.
- **Files:** `loginDirectoryStatus.ts`, `loginFlow.ts` (thin adapter).
- **Tests:** `loginDirectoryStatus.test.ts` (unit); `idpAccessCheck.test.ts`, `loginFlowProvider.test.ts`, `idpOutage.test.ts` (integration).
- **Seams:** `decideLoginDirectoryStatus` (module); `finishLogin` (package).
