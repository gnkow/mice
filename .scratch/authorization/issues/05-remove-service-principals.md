# 05: Remove Service Principals

**What to build:** Remove service principal functionality completely. Service principal creation, management, and authentication no longer exist. Job tokens tied to the submitting user are `.scratch/jobs/issues/01-job-commit-attribution.md` and `.scratch/jobs/issues/02-job-token-lifetime-and-commit-hold.md`.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Delete `servicePrincipals` table from schema
- [ ] Remove service principal creation/management routes
- [ ] Remove `decideServicePrincipalManage` function
- [ ] Remove `serviceprincipal.admin` instance action
- [ ] Remove service principal authentication logic
- [ ] Remove service principal UI components
- [ ] Remove service principal types and interfaces
- [ ] Tests verify no service principal routes are reachable
