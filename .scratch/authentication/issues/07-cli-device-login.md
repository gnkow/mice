Status: done

# 07: Short-lived CLI credential

**Spec:** `.specs/01-authentication.md` (stories 3 and 4, Q5, Q56, Q73, U5)

OS keychain storage is issue 35. Removing every other PAT mint path is issue 48.

## Outcome

Device approval issues an 8-hour access token and a rotating refresh token. It does not mint a personal access token. Refresh replaces both tokens. Presenting a refresh token again revokes that family. A family older than 30 days cannot be refreshed. Refresh asks the IdP first and leaves the refresh token unused when the user is disabled or the IdP cannot be reached. Logout revokes the CLI family and ends that Principal's web sessions.

`POST /auth/cli/device/poll` returns `access_token`, `refresh_token`, and `expires_in`. `POST /auth/cli/refresh` rotates the pair. `POST /auth/cli/logout` revokes a CLI access token.

## Acceptance

- [x] Device approval issues an 8-hour access token and a rotating refresh token, and does not call `createPat`
- [x] Reuse of a refresh token revokes that token family
- [x] A family older than 30 days cannot be refreshed
- [x] Refresh re-checks the IdP and fails when the user is disabled or the IdP is unreachable
- [x] Logout revokes the CLI credential and the web session
- [x] The live device-login tests cover issuance, and the credential tests cover rotation, reuse, the family cap, and the IdP re-check

## Code

- `auth/src/authentication/credentials/cliCredentials.ts`
- `auth/src/authentication/credentials/cliDevice.ts`
- `auth/src/authentication/credentials/cliDeviceRoutes.ts`

## Comments

- **Audit:** holds — acceptance covered by `cliCredentials.test.ts` (issue/rotate/reuse/family/IdP/logout) and device-flow issuance paths.
- **Deepen:** Collapsed refresh→HTTP status/body mapping into `cliRefreshReply` (IdP outage → 503, else 401) and shared token-pair minting via internal `mintPair` used by issue + refresh. Route refresh handler is one call through that seam.
- **Files:** `auth/src/authentication/credentials/cliCredentials.ts`, `cliCredentials.test.ts`, `cliDeviceRoutes.ts`.
- **deep-api Deepen** (auto-pick Top): Extracted pure `decideCliRefreshTokenState` (unknown/reuse/expired + markFamilyRevoked) and `decideCliRefreshIdpAccess` so refresh transaction only mutates after both gates allow. `cliRefreshReply` / `mintPair` kept. Unit: `cliCredentials.test.ts` (decision matrix + existing issue/rotate/reuse/family/IdP/logout).

2026-11-13: /deep-ui skipped — no-ui (API/CLI/boot acceptance only). User acknowledged skip on authentication deep-ui board.

2026-11-13: **/deep-ui Deepen (reclassified UI)** — supersedes the no-ui skip above.
- **Board:** reclassified from no-ui → holds (Deepen). Surface: `ProfileCliAccessSection` + nested `DeviceSessionsList`.
- **Deepen:** Clarify short-lived CLI device credentials (8-hour access + rotating refresh; no PAT mint). List/revoke UX aligned with web-sessions chrome (`data-testid="cli-device-credentials"`, empty/error/retry, aria-labels on Revoke).
- **E2E:** `e2e/tests/profile-cli-credentials.spec.ts` — `TC-AUTH-CLI-07` (copy: short-lived / no PAT mint), `TC-AUTH-CLI-07b` (approve → list → revoke).
- **Files:** `web/src/components/ProfileCliAccessSection.tsx`, `web/src/components/DeviceSessionsList.tsx`, `e2e/tests/profile-cli-credentials.spec.ts`.
