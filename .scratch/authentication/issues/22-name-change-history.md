Status: done

# 22: Name change history

**Spec:** `.specs/01-authentication.md` (U11, storage half)

Showing the current name next to the name at signing, and an admin timeline, is issue 47.

## Outcome

`principal_name_history` stores each name with `valid_from` and `valid_to`. `ensurePrincipal` calls `trackNameChange` on login. A changed name closes the previous row and opens a new one. An unchanged name does not insert a duplicate. Signature records keep `session.name`, which is the name at signing time. `getNameAtTime` and `getNameHistory` read the timeline.

## Acceptance

- [x] The history table records name, valid from, and valid to
- [x] Login opens a new history row when the IdP name changes and closes the previous row
- [x] A repeated login with the same name does not insert a duplicate row
- [x] The signature record keeps the name from the session at signing time

## Code

- `auth/src/authentication/session/nameChangeHistory.ts`
- `auth/src/authentication/session/session.ts` (`ensurePrincipal`)
- `auth/src/db/schema.ts` (`principalNameHistory`)
- `auth/src/authentication/compliance/nameHistoryRoutes.ts`

## Comments

- **Audit:** holds (acceptance covered by `nameChangeHistory.test.ts` + `nameHistoryRoutes.test.ts`).
- **Deepen:** Principal name timeline module owns interval `getNameAtTime` (`validFrom ≤ t < validTo`), `toAdminNameHistory` / `getAdminNameHistory`; route no longer re-derives current.
- **Tests:** `auth/src/nameChangeHistory.test.ts`, `auth/src/authentication/compliance/nameHistoryRoutes.test.ts`.

2026-11-13 — **Deepen #2 (auto-picked):** Pull write policy into `decideNameHistoryWrite` and interval resolution into `nameValidAt`; `trackNameChange` / `getNameAtTime` are adapters over those decisions.
**Seams:** `nameChangeHistory.ts` (`decideNameHistoryWrite`, `nameValidAt`, `toAdminNameHistory`); `nameHistoryRoutes.ts` HTTP adapter.
**Tests:** `nameChangeHistory.test.ts` (unit), `nameHistoryRoutes.test.ts` (integ).

2026-11-13: deep-api Deepen (holds) — auto-picked Top architecture recommendation; unit+integration strengthened at ticket seams; Status remains done.

2026-11-13: /deep-ui skipped — no-ui (API/CLI/boot acceptance only). User acknowledged skip on authentication deep-ui board.
