# 05: Remove Service Principals

**What to build:** Remove service principal functionality completely. Service principal creation, management, and authentication no longer exist. Job tokens tied to the submitting user are `.scratch/jobs/issues/01-job-commit-attribution.md` and `.scratch/jobs/issues/02-job-token-lifetime-and-commit-hold.md`.

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
