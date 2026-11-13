# 05: Remove Service Principals

**What to build:** Remove service principal functionality completely. Service principal creation, management, and authentication no longer exist. Job tokens tied to the submitting user are `.scratch/jobs/issues/01-job-commit-attribution.md` and `.scratch/jobs/issues/02-job-token-lifetime-and-commit-refusal.md`.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Delete `servicePrincipals` table from schema
- [x] Remove service principal creation/management routes
- [x] Remove `decideServicePrincipalManage` function
- [x] Remove `serviceprincipal.admin` instance action
- [x] Remove service principal authentication logic
- [x] Remove service principal UI components
- [x] Remove service principal types and interfaces
- [x] Tests verify no service principal routes are reachable

## Comments

**Deep-api Deepen (2026-11-13):** Single seam `servicePrincipalsRemoved` documents removal + retired paths/issuer; cleaned stale SP/PAT route comments in `app.ts`. Unit+integration: `servicePrincipalsRemoved.test.ts` (no `decideServicePrincipalManage` / `servicePrincipals` table / `serviceprincipal.admin`; `decideInstanceAction` rejects the retired action; `decideServiceCallerAdmission` refuses `urn:mice:service`; GET/POST/DELETE on retired paths → 404).
