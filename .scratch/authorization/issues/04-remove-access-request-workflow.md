# 04: Remove Access Request Workflow

**What to build:** Remove the access request feature completely. Users who log in with no namespace grants see an empty list (0 namespaces, 0 repos) rather than a "pending user" page or request access UI. Managers grant access directly through the admin UI. The request/approval workflow no longer exists.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Delete `accessRequests` table from schema
- [ ] Remove routes: `POST /auth/access-requests`, `GET /auth/access-requests`, `POST /auth/access-requests/:id`
- [ ] Remove functions: `submitAccessRequest`, `resolveAccessRequest`, `listAccessRequests`, `canReviewAccessRequests`
- [ ] Remove `isPendingUser` logic and pending user page UI
- [ ] Remove "request access" buttons and forms from UI
- [ ] Users with no grants see empty namespace/repo lists (no special pending state)
- [ ] Remove access request user stories and implementation decisions from code comments
- [ ] Remove `review_access_requests` namespace capability (no longer used)
- [ ] Tests verify users with no grants see empty lists
- [ ] Tests verify no access request routes are reachable
