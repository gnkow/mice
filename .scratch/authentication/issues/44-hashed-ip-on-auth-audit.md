Status: done

# 44: Hashed IP on authentication audit events

**Spec:** `.specs/01-authentication.md` (U8)

**Blocked by:** none

Split from issue 16. The salt, the hash function, and the device-approval display stay there.

## What to build

Every authentication audit event (login, refresh, logout, step-up, failure, revocation) stores `hashed_ip` as SHA-256(IP + that day's salt). The raw IP is not stored. Events with no client IP omit the field.

## In code today

`recordAuthEvent` stores `hashed_ip` from `hashIp` when `clientIp` is present. The queried event returns that hash and not the raw address. A missing address leaves the field unset. Device approval still uses the same hash.

## Acceptance

- [x] Login, refresh, logout, step-up, failure, and revocation events store `hashed_ip` when a client IP is present
- [x] The stored value matches `hashIp` for that IP on that UTC day
- [x] The raw IP is absent from the audit record and from operational logs of these events
- [x] A missing client IP leaves `hashed_ip` unset

## Comments

- **Audit:** holds — `recordAuthEvent` stores hashed_ip for login/refresh/logout/step-up/failure/revocation; raw IP absent (`authEvents.test.ts`).
- **Deepen (auto-pick):** Extracted audit attachment seam `prepareAuthEventForStore` (redact + attach hashed_ip via injectable `hash`); `recordAuthEvent` persists through that seam. `createIpHash` / `ipHash.ts` API untouched.
- **Files:** `authEvents.ts`, `authEvents.test.ts`.

2026-11-13 — deep-api Deepen (auto-pick Top): **holds** + integration gap closed.
- **Seams:** `prepareAuthEventForStore` / `recordAuthEvent` (hash port).
- **Deepen:** `recordAuthEvent(input, { hash })` passes the injectable hash through prepare→persist so write-path integ can prove `hashed_ip` without salt fixtures.
- **Integ:** `authEvents.hashedIp.integration.test.ts` — write→query stores `hashed_ip` matching `hashIp`; injectable hash port; missing IP leaves field unset.
- **Files:** `authEvents.ts`, `authEvents.test.ts`, `authEvents.hashedIp.integration.test.ts`.

2026-11-13: /deep-ui skipped — no-ui (API/CLI/boot acceptance only). User acknowledged skip on authentication deep-ui board.

2026-11-13: **/deep-ui Deepen (reclassified UI)** — supersedes the no-ui skip above.
- **Board:** reclassified from no-ui → holds (Deepen). Surface: `AuthEventLog` (Profile Security Activity).
- **Deepen:** `/auth/me/events` includes `hashedIp` when stored; UI shows truncated Hashed IP (`data-testid="auth-event-hashed-ip"`) with full hash in `title` — never raw IP.
- **E2E:** `e2e/tests/profile-auth-events.spec.ts` — `TC-AUTH-AEL-44` (logout with `X-Forwarded-For` → assert API + UI hashed IP).
- **Files:** `auth/src/authentication/audit/authEventRoutes.ts`, `authEventRoutes.test.ts`, `web/src/components/AuthEventLog.tsx`, `e2e/tests/profile-auth-events.spec.ts`.
