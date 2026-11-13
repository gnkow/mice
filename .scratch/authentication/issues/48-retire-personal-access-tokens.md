Status: done

# 48: Retire personal access tokens

**Spec:** `.specs/01-authentication.md` (stories 3 and 4, Q5, Q14)

## What to build

No route mints a personal access token. Bearer authentication does not accept a PAT. Users see and revoke CLI credentials from issue 07, not PATs. Existing PAT rows cannot authenticate.

## Acceptance

- [x] Token-creation routes are gone
- [x] A bearer PAT receives 401
- [x] Device approval no longer calls `createPat` (issue 07)
- [x] The profile page lists and revokes CLI credentials
- [x] Tests that used `createPat` as a session stand-in use a web session or the issue 07 credential

## Comments

- **Audit:** holds — no PAT mint routes; `mice_pat_*` bearer → 401; CLI credentials minted as `mice_cli_*` (`authenticate.test.ts`, `cliCredentials.test.ts`).
- **Deepen (auto-pick):** Extracted `isRetiredPersonalAccessToken` / `RETIRED_PAT_PREFIX`; `resolveCliCredential` refuses that prefix before DB lookup so retirement locality lives with credential resolve (requireAuth untouched beyond existing resolveBearer path).
- **Files:** `retiredPersonalAccessToken.ts`, `retiredPersonalAccessToken.test.ts`, `cliCredentials.ts`, `cliCredentials.test.ts`, `authenticate.test.ts`.
- **Deep-API deepen (2026-11-13):** `classifyBearerCredential` → `retired_pat` | `cli` | `unknown`; resolve + refresh refuse retired PAT before DB. `isRetiredPersonalAccessToken` is a thin wrapper.
- **Tests:** `retiredPersonalAccessToken.test.ts`, `cliCredentials.test.ts`, `authenticate.test.ts` (green)

2026-11-13: /deep-ui skipped — no-ui (API/CLI/boot acceptance only). User acknowledged skip on authentication deep-ui board.
