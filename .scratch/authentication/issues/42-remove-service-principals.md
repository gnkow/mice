Status: done

# 42: Remove service principals

**Spec:** `.specs/01-authentication.md` (Q12, Q13, Q14, consolidated position)

**Blocked by:** none

Jobs use the BFF-internal token in `.scratch/jobs/issues/02-job-token-lifetime-and-commit-refusal.md`. They are not service principals.

## What to build

Mice has no service-principal issuer, no service-principal records, and no route that creates or authenticates one. Automated work is attributed to the submitting human plus the job marker from `.scratch/jobs/issues/01-job-commit-attribution.md`.

## In code today

A Session or bearer credential whose issuer is `urn:mice:service` is not a caller. `kindOf` returns `human` only. Revoking a person ends that person's credentials and does not look for owned service principals. There is no create route. The `service_principals` table is still in the schema; removing it is authorization issue 05.

## Acceptance

- [x] No route creates a service principal or accepts `urn:mice:service` as a caller
- [x] Owner-revoke no longer cascades to service principals, because none exist
- [x] Tests that authenticated as a service principal use a human session instead
- [x] `kindOf` no longer has a service kind

## Comments

- **Audit:** holds — `kindOf` human-only; `authenticate` refuses `urn:mice:service` session/bearer; no SP create route; offboarding does not cascade.
- **Deepen (auto-pick Top):** `decideServiceCallerAdmission` owns allow / 401 refusal; session + bearer paths in `authenticate` share it (no wholesale requireAuth rewrite).
- **Files:** `principal.ts`, `requireAuth.ts` (two call sites).
- **Tests:** `principalKind.test.ts` (unit); `serviceCaller.test.ts` (integration).
- **Seams:** `decideServiceCallerAdmission` / `isServiceCaller` (module); `authenticate` (package).

2026-11-13: deep-api Deepen (holds) — auto-picked Top architecture recommendation; unit+integration strengthened at ticket seams; Status remains done.
