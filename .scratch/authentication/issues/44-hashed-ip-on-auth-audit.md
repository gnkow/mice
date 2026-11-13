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
