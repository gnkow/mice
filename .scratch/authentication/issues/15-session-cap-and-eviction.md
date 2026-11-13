Status: done

# 15: Session cap and eviction

**Spec:** `.specs/01-authentication.md` (U4)

## Outcome

`sealSession` allows five concurrent web sessions per Principal. The sixth insert deletes the oldest row by `sessionStart` and appends an audit event `session.evict` with the evicted session hash and reason `cap-exceeded`. The user can still revoke a chosen session from the session list (issue 03).

## Acceptance

- [x] A Principal can hold five active web sessions
- [x] Creating a sixth session deletes the oldest
- [x] Eviction writes `session.evict` with the evicted session id and reason `cap-exceeded`
- [x] Eviction for one Principal leaves another Principal's sessions in place

## Code

- `auth/src/authentication/session/sessionCap.ts` (`enforceWebSessionCap`, `sessionToEvictForCap`)
- `auth/src/authentication/session/session.ts` (`sealSession` → one call to enforce)
- `auth/src/authentication/session/sessionCap.test.ts`

## Comments

2026-11-13 — Checkmate audit: **holds** (acceptance covered by `sessionCap.test.ts`).

**Deepen (auto-picked):** Extract cap/evict + `session.evict` audit into deep `sessionCap` module (`sessionToEvictForCap` + `enforceWebSessionCap`); `sealSession` only delegates. No wholesale session.ts rewrite.

**Files:** `sessionCap.ts`, `sessionCap.test.ts`, `session.ts` (call site only)
