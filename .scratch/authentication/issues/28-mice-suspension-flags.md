Status: done

# 28: Mice suspension flags

**Spec:** `.specs/01-authentication.md` (Q72)

**Blocked by:** none

Previously filed as `06-mice-suspension-flags.md`. Admin revoke of sessions and credentials is issue 06 and stays as it is. Re-enable consults these flags in issue 27.

## What to build

A Mice suspension flag is independent of IdP status. While `suspended` is set, login and every authenticated request are refused, and existing sessions stop working. Grants stay in place. An admin sets and lifts the flag with a reason. Both actions, and each refusal, are audited.

## Outcome

`principals.flags` holds Mice flags. `POST /auth/admin/mice-suspension` adds `suspended` for an `iss|sub` Principal, deletes that Principal's web Sessions, and records the set. `POST /auth/admin/mice-suspension/lift` removes the flag and records the lift. `GET /auth/admin/mice-suspension?principal=iss|sub` returns the history oldest first, each row with flag, action (`set` or `lift`), reason, actor `iss|sub`, and time. Instance permissions and namespace memberships are left as they were.

Login (`completeLogin`) and `authenticate` refuse a Principal whose flags include `suspended` while the directory user is enabled. A Session sealed before the set no longer resolves. A Session sealed after the set, and a PAT, answer 403 `{ error: 'Suspended' }`. The next login after a lift succeeds with the same grants.

Set is audited as `admin.mice_suspension.set` (`Suspended iss|sub`). Lift is audited as `admin.mice_suspension.lift` (`Lifted suspension of iss|sub`). A refused request is `auth.suspended` with message `Refused iss|sub`. A refused login is `auth.suspended` with message `Refused login iss|sub`.

Issue 06's pending two-admin suspend is a different route and is unchanged.

## Code

- `auth/src/authentication/access/miceSuspension.ts`
- `auth/src/authentication/access/miceSuspensionRoutes.ts`

## Comments

- **Audit:** holds — set/lift history, session wipe with grants preserved, login/`authenticate` refusal while IdP-enabled, and audits proven by `miceSuspension.test.ts`.
- **Deepen (auto-pick Top):** Collapsed set/lift into one deep transactional `applyFlagChange('set'|'lift')` in `miceSuspension.ts` (flag write + session wipe + history in one `inTransaction`). `suspendPrincipal` / `liftSuspension` / `isSuspended` / `suspensionHistory` remain the public seams; routes stay thin adapters. No further deepen (already deep).
- **Integration:** `miceSuspensionRoutes.api.test.ts` — HTTP set → history → lift → history, authenticate 403 while suspended, 404 missing principal, 400 bad format; uses `regulatedMutationHeaders` (no loginFlow).
- **Files:** `auth/src/authentication/access/miceSuspension.ts`, `miceSuspensionRoutes.ts`, `miceSuspension.test.ts`, `miceSuspensionRoutes.api.test.ts`.

## Acceptance

- [x] `principals` stores Mice flags, and a history table records set and lift with reason, actor, and time
- [x] Login and `authenticate` refuse a Principal whose flags include `suspended`, including when the IdP user is enabled
- [x] Setting the flag ends current sessions and leaves instance permissions and namespace memberships unchanged
- [x] Lifting the flag restores access on the next login without recreating grants
- [x] Set, lift, and refusal are audited

2026-11-13: deep-api Deepen (holds) — auto-picked Top architecture recommendation; unit+integration strengthened at ticket seams; Status remains done.
