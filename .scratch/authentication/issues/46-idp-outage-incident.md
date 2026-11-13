Status: done

# 46: IdP outage incident record

**Spec:** `.specs/01-authentication.md` (R7, T5)

**Blocked by:** none

Split from issue 11. Login and authenticated requests already fail closed (issues 19 and 38).

## What to build

When the IdP or directory is unreachable, Mice records an incident that points at the paper procedure in the validation pack. The incident includes the start time, the failing check, and the request id of the first failure in that outage. A later success closes the incident. There is no local emergency account and no grace login.

## In code today

An unreachable directory on login or on an authenticated request opens one `idp_outages` row. The row stores the start time, the failing check, the request id, and `validation-pack:idp-outage`. A later 503 in that outage keeps the first row. The next directory answer closes it. A disabled account is an answer, so it does not open an incident. No route creates a local account. The paper procedure document stays in issue 13.

## Acceptance

- [x] The first 503 caused by an unreachable IdP opens one incident for that outage
- [x] The incident references the paper procedure
- [x] Further 503s in the same outage do not open a second incident
- [x] The next successful IdP check closes the incident
- [x] No route creates a local account because the IdP is down

## Comments

2026-11-13: Checkmate audit — **holds** (acceptance green via login flow + `authenticate` 503/recovery paths).

**Deepen (auto-pick):** Replace dual `noteIdpOutage` / `closeIdpOutage` caller protocol with deep `recordIdpCheck({ reachable, … })` (local-substitutable DB). Open-once / close-on-answer locality stays in one module; `loginFlow` and `requireAuth` each make one call.

**Files:** `auth/src/authentication/compliance/idpOutage.ts`, `auth/src/authentication/compliance/idpOutage.test.ts`, `auth/src/authentication/oidc/loginFlow.ts`, `auth/src/authentication/session/requireAuth.ts`

- **Deep-API deepen (2026-11-13):** Extracted pure `decideIdpOutageMutation(hasOpen, check)` (open-once / close-on-answer / noop); `recordIdpCheck` applies it. No `loginFlow` / `idpCheck` edits.
- **Tests:** `idpOutage.test.ts` unit + integration (green)

2026-11-13: /deep-ui skipped — no-ui (API/CLI/boot acceptance only). User acknowledged skip on authentication deep-ui board.
