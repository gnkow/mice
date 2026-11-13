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

2026-11-13: Checkmate audit — **holds** (acceptance green at `finishLogin` / `completeLogin`; proving tests in `idpAccessCheck.test.ts`, `loginFlowProvider.test.ts`, `idpOutage.test.ts`).

**Deepen (auto-pick):** Collapse directory `userStatus` → HTTP refuse mapping into deep `decideLoginDirectoryStatus(status)` (in-process). `recordIdpCheck` API unchanged — loginFlow still records reachability; decision owns 503 unreachable / 403 disabled|missing / allow. Disabled side-effect flag (`recordDisabled`) stays behind the decision.

**Files:** `auth/src/authentication/oidc/loginDirectoryStatus.ts`, `auth/src/authentication/oidc/loginDirectoryStatus.test.ts`, `auth/src/authentication/oidc/loginFlow.ts`

**Tests:** `loginDirectoryStatus.test.ts`; regression `idpAccessCheck.test.ts`, `loginFlowProvider.test.ts`, `idpOutage.test.ts`
