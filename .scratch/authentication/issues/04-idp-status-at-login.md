Status: done

# 04: IdP status at login

**Spec:** `.specs/01-authentication.md` (U3, login half)

Per-request checks are issue 19. Login status code when the directory is unreachable is issue 38. Follow-ups that this file used to contain:

- 27 principal re-enable (done)
- 28 Mice suspension flags
- 29 auto-provision baseline
- 30 identity reuse (wontfix, ADR 0006)
- 31 group object ids

## Outcome

`finishLogin` asks the directory for the user's status before creating a session. `disabled` and `missing` refuse login with 403. A later request-path check is issue 19.

## Acceptance

- [x] A directory status of `disabled` refuses login
- [x] A directory status of `missing` refuses login
- [x] Login does not create a session for those two statuses

## Code

- `auth/src/authentication/oidc/loginDirectoryStatus.ts` (`decideLoginDirectoryStatus`)
- `auth/src/authentication/oidc/loginFlow.ts` (`finishLogin` — thin call + side effects)

## Comments

- **Audit:** holds — `disabled` / `missing` refuse login with 403; no session created for those statuses.
- **Deepen (auto-pick Top):** Extracted pure `decideLoginDirectoryStatus` so allow/refuse HTTP/message/`recordDisabled` live in one module. `finishLogin` only records IdP reachability / IdP-disabled history then maps the decision; no rewrite of the rest of loginFlow. `idpOutage*` / `reenable*` / `miceSuspension*` untouched.
- **Tests:** `auth/src/authentication/oidc/loginDirectoryStatus.test.ts`; acceptance still green in `loginFlowProvider.test.ts`
- **deep-api Deepen** (auto-pick Top; share with 38): Added `applyLoginDirectoryDecision` / `gateLoginDirectoryStatus` so reachability recording then IdP-disabled history order live once; `finishLogin` only supplies hooks + maps the gate to fail/continue. Ticket 38 `error`→503/`unreachable` stays in the same decide table (no duplicate branching). Unit: `loginDirectoryStatus.test.ts` (effect order for enabled/disabled/missing/error). Integ: `loginFlowProvider.test.ts` still green.

2026-11-13 — deep-ui Deepen (holds → UI surface):
- **Surfaces:** `LoginPage` status alert for `disabled` / `missing`; BFF `/auth/callback` redirects `?status=` (via `surface` on directory gate).
- **Deepen:** Titled `role=alert` region (no orphan error text); copy matches BFF messages; `decideLoginStatus` in `web/src/lib/loginStatus.ts`.
- **E2E:** `e2e/tests/login-status.spec.ts` — disabled + missing cases. Run: `npm run test:e2e -- e2e/tests/login-status.spec.ts`
- **Status:** done
