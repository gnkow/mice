# 05: Remove Service Principals

**What to build:** Remove service principal functionality completely. Jobs use BFF-internal tokens tied to the submitting user rather than separate service principal identities. Service principal creation, management, and authentication no longer exist.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Delete `servicePrincipals` table from schema
- [ ] Remove service principal creation/management routes
- [ ] Remove `decideServicePrincipalManage` function
- [ ] Remove `serviceprincipal.admin` instance action
- [ ] Remove service principal authentication logic
- [ ] Update job execution to use BFF-internal tokens attributed to submitting user
- [ ] Remove service principal UI components
- [ ] Remove service principal types and interfaces
- [ ] Tests verify job tokens are user-attributed (not service principal)
- [ ] Tests verify no service principal routes are reachable
