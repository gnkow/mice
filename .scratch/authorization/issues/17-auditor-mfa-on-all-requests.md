Status: done

# 17: Auditor MFA on every request

**Spec:** `.specs/01-authentication.md` (Q78, T3)

**Follow-up to:** `13-auditor-access.md`

## What to build

Ticket 13 requires MFA evidence for the Auditor's cross-ACL read bypass (`authz.ts`, repo routes) and for instance actions (`decideInstanceAction`, including audit reads). Other paths are not gated. An Auditor session without MFA can still use namespace and repo routes that it reaches through ordinary membership or ACL grants, and any route that does not go through those two checks.

Gate the Auditor role at one place that every authorization decision passes through, so the rule cannot be bypassed by a new route.

## Acceptance

- [x] List every decision path an Auditor session can reach (instance, namespace, repo, lineage, signing)
- [x] An Auditor session without MFA is refused on all of them with a single reason
- [x] The rule lives in one function, not repeated per check
- [x] A test per decision path fails without the gate

## Comments

**Done.** `authenticate()` (`requireAuth.ts`) is the single gate: after the principal is prepared, `auditorMfaRefusal(user)` in `authz.ts` refuses an Auditor-role principal without MFA evidence with 403 "Auditor access requires MFA evidence". It covers cookie sessions and CLI credentials, and therefore every route that authenticates: instance, namespace, repo (`/api/*`), lineage and signing. `decideInstanceAction` reuses the same function.

- `/auth/me` is the only exemption (`allowAuditorWithoutMfa`), so the UI can still identify the user; logout reads the session directly.
- `/api/*` now returns the authentication outcome's real status and message instead of a blanket 401.
- Tests: `authentication/session/authenticate.test.ts` (gate) and `auditorMfaEveryRoute.test.ts` (one test per decision path, plus `/auth/me`).
