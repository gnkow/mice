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

2026-11-13: **/deep-ui Deepen (reclassified UI)** — supersedes the no-ui skip above.
- **Board:** reclassified from no-ui → holds (Deepen). Surfaces: `ProfileCliAccessSection` + `CloneBox` (device credentials only).
- **Deepen:** Retire Automation PAT / `<PAT>` copy from Clone box; Access section + empty-state copy state device credentials only (no PAT mint). `/auth/cli-info` `configExample` points at `mice login`.
- **E2E:** `e2e/tests/cli-auth.spec.ts` — `TC-CLI-48` (no Automation PAT / `<PAT>`); `TC-CLI-06` expects mice-login configExample; profile copy covered by `TC-AUTH-CLI-07`.
- **Files:** `web/src/components/CloneBox.tsx`, `web/src/components/ProfileCliAccessSection.tsx`, `auth/src/authentication/credentials/cliDeviceRoutes.ts`, `e2e/tests/cli-auth.spec.ts`, `e2e/tests/profile-cli-credentials.spec.ts`.
