Status: ready-for-agent

# 16 — Role-Based Access Control with Request/Approval Workflow

## Problem Statement

The current authorization system uses boolean instance admin flags and individual permission grants without formal roles. There is no structured way for users to request access, and no workflow for managers/admins to approve requests. The system needs formal roles with clear permission bundles, a request/approval workflow, and complete audit trail.

## Solution

Implement a role-based access control (RBAC) system with 5 formal roles (External User, User, Manager, Auditor, Admin), each with a defined permission set. Users without access submit role-based or custom permission requests. Managers and admins review and approve requests up to their authority level. All permission changes are versioned in PostgreSQL history tables and audited in immudb.

## User Stories

1. As a new user with no access, I want to request a role (External/User/Manager), so that I can gain appropriate access
2. As a user, I want to request additional permissions beyond my current role, so that I can expand my capabilities
3. As a manager, I want to review pending access requests, so that I can approve team members
4. As a manager, I want to approve requests only up to my permission level, so that I cannot grant more than I have
5. As an admin, I want to directly grant roles and permissions to users without requiring a request, so that I can onboard quickly
6. As an admin, I want all permission changes audited with who/what/when/why, so that we have compliance trail
7. As an auditor, I want to read all data bypassing repository ACLs, so that I can perform compliance reviews
8. As an admin, I want to manage the system but NOT access data/audits, so that separation of duties is enforced
9. As a user, I want to see my current role and permissions in my profile, so that I understand my access level
10. As a manager, I want to modify requested permissions before approval, so that I can grant appropriate subset

## Acceptance Criteria

### Role System
- [ ] 5 formal roles defined: External User, User, Manager, Auditor, Admin
- [ ] Each role has a defined permission bundle (150+ granular permissions)
- [ ] Role hierarchy for approval authority: Manager can approve up to Manager, Admin can approve all
- [ ] Auditor role has `repo:bypass_acl` permission for universal read access
- [ ] Admin role has NO data/audit read permissions (separation of duties)

### Permission Model
- [ ] Maximum granularity: `<resource>:<sub-resource>:<operation>` (e.g., `repo:files:read`)
- [ ] 150+ instance permissions across 16 categories
- [ ] Permissions stored as extensible TEXT[] (no schema changes for new permissions)
- [ ] Users can have role + additional custom permissions
- [ ] Permission catalog documented in authorization spec

### Database Schema
- [ ] `principal_roles` table: current active role per user
- [ ] `principal_role_history` table: immutable role change log
- [ ] `principal_permissions` table: custom permissions beyond role
- [ ] `principal_permission_history` table: immutable permission change log
- [ ] `access_requests` table: request/approval workflow
- [ ] `permission_snapshots` table: periodic audit snapshots
- [ ] All tables have proper indexes and constraints
- [ ] One pending request per user constraint enforced

### Access Request Workflow
- [ ] No-access users see ONLY "Request Access" UI (no navigation)
- [ ] Request form supports: role selection OR custom permission selection
- [ ] Request includes user justification message
- [ ] Only one pending request allowed per user at a time
- [ ] Pending requests stored in `access_requests` table with status enum

### Approval Workflow
- [ ] Managers see pending requests in Settings → Access Requests
- [ ] Requests filtered by reviewer's approval authority (Manager sees up to Manager role requests)
- [ ] Reviewer can modify requested role/permissions before approval
- [ ] Approval blocked if reviewer lacks requested permissions
- [ ] Optional approval reason field
- [ ] Deny option with reason
- [ ] Approved request updates role and/or permissions immediately

### Direct Grant
- [ ] Admins/Managers can grant roles/permissions directly in Settings (bypass request)
- [ ] Direct grants follow same authority rules (cannot grant more than you have)
- [ ] Direct grants recorded in audit trail same as request approvals

### Authorization Logic
- [ ] `getUserRole(user)` returns active role
- [ ] `getEffectivePermissions(user)` merges role permissions + custom permissions
- [ ] `hasPermission(user, permission)` checks effective permissions
- [ ] `canApproveRequest(reviewer, request)` validates approval authority
- [ ] All API endpoints updated to check new permission model
- [ ] Auditor bypass ACL implemented in repository read checks

### Profile UI
- [ ] Profile → Account shows role badge (Admin/Manager/User/Auditor/External/Pending)
- [ ] Profile → Permissions tab lists all instance permissions with checkboxes (checked = granted)
- [ ] "Request Additional Permissions" button in Permissions tab
- [ ] Request form allows role upgrade OR individual permission selection
- [ ] Pending request indicator shown in profile

### Request Access UI (No-Access Users)
- [ ] Full-screen "Request Access" component (nothing else visible)
- [ ] Role selection: External User, User, Manager (radio buttons with descriptions)
- [ ] Custom permissions multi-select (advanced option)
- [ ] Justification textarea (required)
- [ ] Submit button creates access request
- [ ] After submit: "Request Pending" message with no navigation

### Settings Access Requests UI
- [ ] Settings → Access Requests tab (visible to managers/admins)
- [ ] List pending requests with: user name/email, requested role, requested permissions, justification, date
- [ ] Filter by status: pending/approved/denied
- [ ] Request detail modal: shows user info, current role, requested changes
- [ ] Modify requested role/permissions dropdown (before approval)
- [ ] Approval reason textarea (optional)
- [ ] Approve button (validates authority, blocks if insufficient)
- [ ] Deny button with reason
- [ ] Authority validation message if cannot approve

### Direct Grant UI
- [ ] Settings → Users section with user list
- [ ] Each user row shows: name, email, current role, custom permissions count
- [ ] "Grant Access" button opens modal
- [ ] Modal: role dropdown, custom permissions multi-select, reason textarea
- [ ] Submit directly grants without creating request
- [ ] Authority validation (same rules as approval)

### Audit Trail
- [ ] Every role grant/revoke recorded in `principal_role_history`
- [ ] Every permission grant/revoke recorded in `principal_permission_history`
- [ ] Every access request approval/denial recorded with reviewer and reason
- [ ] All changes audited to immudb with action, actor, subject, timestamp, reason
- [ ] Audit events include: `role.assign`, `role.revoke`, `permission.grant`, `permission.revoke`
- [ ] Access request ID linked in audit events

### Versioning
- [ ] History tables are append-only (never updated or deleted)
- [ ] Role changes track: granted_at, granted_by, revoked_at, revoked_by
- [ ] Permission changes track: granted_at, granted_by, revoked_at, revoked_by
- [ ] Reasons stored for all changes
- [ ] Permission snapshots created on role/permission changes

### Testing
- [ ] Test: No-access user sees only Request Access UI
- [ ] Test: User requests User role → approved → can write repos
- [ ] Test: User requests Manager role → approved → can create namespaces
- [ ] Test: Manager approves Manager request (same level) → success
- [ ] Test: Manager tries to approve Admin request → blocked
- [ ] Test: Manager tries to approve permissions they lack → blocked with error message
- [ ] Test: Admin directly grants Auditor role → user can read all repos bypassing ACL
- [ ] Test: Auditor reads private repo without collaborator access → allowed
- [ ] Test: Admin tries to read audit logs → denied (no `audit:read` permission)
- [ ] Test: User submits second request while first pending → blocked
- [ ] Test: All permission changes recorded in PostgreSQL history tables
- [ ] Test: All permission changes audited to immudb with complete metadata
- [ ] Test: Effective permissions correctly merge role + custom permissions

## Implementation Plan

### Phase 1: Database Schema (Week 1)
- Create all tables in `auth/src/db/schema.ts`
- Add indexes and constraints
- Create TypeScript types for roles and permissions
- Write migration scripts (greenfield, no existing data migration)

### Phase 2: Authorization Logic (Week 1-2)
- Implement `getUserRole()`, `getEffectivePermissions()`, `hasPermission()`
- Implement `canApproveRequest()` with authority validation
- Update `authz.ts` with new permission checking logic
- Implement Auditor bypass ACL logic
- Update all API endpoint guards to use new system

### Phase 3: Access Request Backend (Week 2)
- Create `POST /auth/access-requests` (submit request)
- Create `GET /auth/access-requests` (list for reviewers)
- Create `POST /auth/access-requests/:id/approve` (approve with optional modifications)
- Create `POST /auth/access-requests/:id/deny` (deny with reason)
- Implement one-pending-request constraint enforcement
- Add request status updates

### Phase 4: Direct Grant Backend (Week 2)
- Create `POST /auth/users/:id/grant-role` (direct role grant)
- Create `POST /auth/users/:id/grant-permissions` (direct permission grant)
- Implement same authority validation as approval
- Record in history tables and audit trail

### Phase 5: Request Access UI (Week 3)
- Create `RequestAccessPage` component (full-screen)
- Role selection form with descriptions
- Custom permissions multi-select
- Submit request flow
- "Pending" state UI

### Phase 6: Profile Permissions UI (Week 3)
- Update Profile → Account with role badge
- Create Profile → Permissions tab
- List all permissions with checkbox grid
- "Request Additional Permissions" button and modal
- Show pending request indicator

### Phase 7: Settings Access Requests UI (Week 3-4)
- Create Settings → Access Requests tab
- Request list with filters
- Request detail modal with modification capability
- Approve/deny flows with reason
- Authority validation UI

### Phase 8: Direct Grant UI (Week 4)
- Add Settings → Users section
- User list with current roles
- Grant access modal
- Role and permission selection
- Authority validation

### Phase 9: Audit Trail Integration (Week 4)
- Hook all role/permission changes to immudb
- Implement audit event schema
- Add audit event queries
- Create permission snapshot job

### Phase 10: Testing & Documentation (Week 5)
- Write comprehensive test suite
- Test all role combinations
- Test approval authority validation
- Test audit trail completeness
- Update authorization spec
- Create user documentation

## Technical Notes

### Permission Catalog Location
- Full permission catalog in `docs/specs/authorization-system.md`
- 150+ permissions across 16 categories
- Extensible design (no schema changes for new permissions)

### Role Permission Mappings
- **External**: 31 read-only permissions
- **User**: 51 read/write permissions  
- **Manager**: 79 permissions (User + namespace management + approvals)
- **Auditor**: 38 permissions (universal read + bypass ACL)
- **Admin**: 34 permissions (system management, NO data/audit access)

### Authority Validation Algorithm
```typescript
function canApproveRequest(reviewer: Principal, request: AccessRequest): boolean {
  const reviewerRole = reviewer.role
  const requestedRole = request.requested_role
  
  // Admin can approve anything
  if (reviewerRole === 'admin') return true
  
  // Manager can approve up to Manager level
  if (reviewerRole === 'manager') {
    return ['external', 'user', 'manager'].includes(requestedRole)
  }
  
  return false
}

function canGrantPermissions(reviewer: Principal, permissions: string[]): boolean {
  const reviewerPerms = getEffectivePermissions(reviewer)
  // Reviewer must have ALL requested permissions
  return permissions.every(p => reviewerPerms.includes(p))
}
```

### Auditor Bypass ACL
```typescript
async function authorizeRepoRead(user: Principal, repoId: string): Promise<boolean> {
  // Check for bypass permission first
  if (await hasPermission(user, 'repo:bypass_acl')) {
    return true // Auditor bypasses all ACL checks
  }
  
  // Normal ACL check: is collaborator, namespace member, etc.
  return checkRepoCollaborator(user, repoId)
}
```

## Dependencies

- Requires: Current authentication system (OIDC, sessions)
- Requires: Current audit trail (immudb integration)
- Blocks: User onboarding flow
- Blocks: Team/namespace creation flow
- Related: `.specs/02-authorization.md` (update required)

## References

- Detailed spec: `docs/specs/authorization-system.md`
- API endpoint audit: See task output in conversation
- Current authorization: `auth/src/authz.ts`
- Current instance permissions: `auth/src/authzInstanceStore.ts`
- Issue #04: Remove old access request workflow (superseded by this ticket)

## Estimated Effort

**5 weeks** (1 developer)

- Database & core logic: 2 weeks
- Backend APIs: 1 week  
- Frontend UIs: 1.5 weeks
- Testing & docs: 0.5 weeks

## Status

Ready for implementation. All design decisions finalized. Spec complete and extensible.
