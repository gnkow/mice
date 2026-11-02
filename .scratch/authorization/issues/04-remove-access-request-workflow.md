# 04: Remove Access Request Workflow

**Status:** superseded-by-16

**Superseded By:** Issue #16 (Role-Based Access Control with Request/Approval Workflow)

**Reason:** Original plan was to remove access requests entirely. New design re-introduces a more robust role-based request/approval workflow with formal roles, permission bundles, manager approval authority, and complete audit trail.

**Original Plan (now obsolete):**

**What to build:** Remove the access request feature completely. Users who log in with no namespace grants see an empty list (0 namespaces, 0 repos) rather than a "pending user" page or request access UI. Managers grant access directly through the admin UI. The request/approval workflow no longer exists.

**See Instead:** 
- `.scratch/authorization/issues/16-role-based-access-control.md` (new ticket)
- `docs/specs/authorization-system.md` (detailed specification)
- `.specs/02-authorization.md` (updated authorization spec)

---

**Original checklist (obsolete):**

- [ ] ~~Delete `accessRequests` table from schema~~ (superseded - new schema design)
- [ ] ~~Remove routes: `POST /auth/access-requests`, `GET /auth/access-requests`, `POST /auth/access-requests/:id`~~ (superseded - new routes)
- [ ] ~~Remove functions: `submitAccessRequest`, `resolveAccessRequest`, `listAccessRequests`, `canReviewAccessRequests`~~ (superseded - new functions)
- [ ] ~~Remove `isPendingUser` logic and pending user page UI~~ (superseded - new no-access UI)
- [ ] ~~Remove "request access" buttons and forms from UI~~ (superseded - new request UI)
- [ ] ~~Users with no grants see empty namespace/repo lists (no special pending state)~~ (superseded - show request access UI)
- [ ] ~~Remove access request user stories and implementation decisions from code comments~~ (superseded)
- [ ] ~~Remove `review_access_requests` namespace capability (no longer used)~~ (superseded - now `access_request:review` permission)
- [ ] ~~Tests verify users with no grants see empty lists~~ (superseded - test request access UI)
- [ ] ~~Tests verify no access request routes are reachable~~ (superseded - test new routes)
