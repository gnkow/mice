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
