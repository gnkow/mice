Status: done

# 19: Live IdP check on authenticated requests

**Spec:** `.specs/01-authentication.md` (U3, user-status half)

Group refresh on privileged operations is issue 37. The login status code when the directory is unreachable is issue 38. Login-time disabled and missing checks are issue 04.

## Outcome

`authenticate` calls `verifyIdpAccess` on every authenticated request. There is no `lastIdpCheck` field and no 5-minute throttle. A disabled user or an unreachable directory returns 503. Ordinary reads keep the groups captured on the session. Those groups age out with the 8-hour session lifetime.

## Acceptance

- [x] Every authenticated request checks IdP user status
- [x] An unreachable directory or a disabled user returns 503
- [x] Sessions do not store a last-check timestamp
- [x] Ordinary reads use the groups stored on the session

## Code

- `auth/src/authentication/access/idpCheck.ts` (`evaluateLiveIdpAccess`)
- `auth/src/authentication/access/liveIdpAccess.test.ts`
- `auth/src/authentication/access/idpCheck.test.ts`
- `auth/src/authentication/session/requireAuth.ts` (thin adapter over `evaluateLiveIdpAccess`)

## Comments

2026-11-13 — Checkmate audit: **holds** (acceptance covered by `idpCheck.test.ts` + `liveIdpAccess.test.ts`).

**Deepen (auto-picked):** Collapse live IdP status/name decision into deep `evaluateLiveIdpAccess` (injectable lookup); `verifyIdpAccess` / `checkUserIdpStatus` wrap it. `requireAuth` only maps the result + IdP outage/disabled side effects — no wholesale rewrite.

**Files:** `idpCheck.ts`, `liveIdpAccess.test.ts`, `idpCheck.test.ts`, `requireAuth.ts` (adapter only)

2026-11-13 — **Deepen #2 (auto-picked):** Collapse evaluate + outage/disabled recording into `settleLiveIdpAccess`; `requireAuth` only maps deny. Removed unused shallow `verifyIdpAccess` / `checkUserIdpStatus`. Did not change `idpDisplayName` / decision body of `evaluateLiveIdpAccess`.
**Seams:** `idpCheck.ts` (`evaluateLiveIdpAccess`, `settleLiveIdpAccess`); `requireAuth.ts` adapter.
**Tests:** `liveIdpAccess.test.ts` (unit), `idpCheck.test.ts` + `emptyName.integration.test.ts` (integ).

2026-11-13: deep-api Deepen (holds) — auto-picked Top architecture recommendation; unit+integration strengthened at ticket seams; Status remains done.
