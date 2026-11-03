Status: ready-for-agent

# 16 — Role-Based Access Control with Request/Approval Workflow

## Problem Statement

The current authorization system uses boolean instance admin flags and individual permission grants without formal roles. There is no structured way for users to request access, and no workflow for managers/admins to approve requests. The system needs formal roles with clear permission bundles, a request/approval workflow, and complete audit trail.

## Solution

Implement a role-based access control (RBAC) system with 5 formal roles (External User, User, Manager, Auditor, Admin), each with a defined permission set. Users without access submit role-based or custom permission requests. Managers and admins review and approve requests up to their authority level. All permission changes are versioned in PostgreSQL history tables and audited in immudb.

## Locked Decisions

- **Cutover:** Wipe previous instance permissions, instance-admin flags, and the old message-only access-request grant path. No dual-run, no aliases of the old 8-string catalog.
- **Admin:** Separation of duties — role `admin` manages the system only; **no** data/audit read; **no** site-admin repo bypass. Bootstrap grants the Admin role (not a boolean superuser).
- **Expiry:** Keep mandatory `expires_at` on delegated role assignments and custom permission grants (same rules as #14: required for non-bootstrap delegated grants).
- **MVP:** Includes UI (seams 32–36), not backend-only.
- **Process:** TDD (red → green, one seam at a time). **Commit and push after every seam.** Schema lands only as needed for the next red test — not a horizontal “schema week.”

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
- [ ] Delegated role and custom-permission grants require `expires_at`

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
- [ ] Direct grants require expiry (delegated)

### Authorization Logic
- [ ] `getUserRole(user)` returns active role
- [ ] `getEffectivePermissions(user)` merges role permissions + custom permissions
- [ ] `hasPermission(user, permission)` checks effective permissions
- [ ] `canApproveRequest(reviewer, request)` validates approval authority
- [ ] All API endpoints updated to check new permission model
- [ ] Auditor bypass ACL implemented in repository read checks
- [ ] Admin cannot read data/audits (no site-admin bypass)

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
- [ ] Modal: role dropdown, custom permissions multi-select, reason textarea, expiry
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

## Implementation Plan — TDD Seams (subtasks)

Work **one seam at a time**: failing test → minimal implementation → commit → push. Do not write tests at unlisted seams. Wipe of old tables/APIs happens when the replacing seams land (not a separate migration phase).

**Not seams:** Drizzle internals, private helpers, immudb mock call-counts without the audit query/write API.

### Catalog (pure)

- [x] **S01** Permission catalog — full `resource:op` list complete/valid; no schema coupling
- [x] **S02** Role → permission bundle — each of 5 roles maps to its fixed set (key inclusions/exclusions; Admin lacks data/audit; Auditor has `repo:bypass_acl`)
- [x] **S03** Effective merge — `role ∪ custom`, deduped; independent of storage

### Store: roles

- [x] **S04** Assign role — active role set; reason/actor; `expiresAt` required for delegated (non-bootstrap)
- [x] **S05** Revoke / replace role — previous role closed; history append-only
- [x] **S06** Read role — `getUserRole`; expired role treated as none
- [x] **S07** Role history — grant/revoke rows queryable via store API

### Store: custom permissions

- [x] **S08** Grant custom perms — beyond role; expiry required when delegated
- [x] **S09** Revoke custom perms — history append-only
- [x] **S10** Read custom + effective — `getEffectivePermissions` / `hasPermission` (role ∪ custom, expiry-aware)
- [x] **S11** Permission history — via store API
- [x] **S12** Permission snapshots — written on role/perm change; readable via store API

### Authority

- [x] **S13** Role approval authority — Manager ≤ Manager; Admin any role; others none
- [x] **S14** Permission grant authority — reviewer must hold every granted perm
- [x] **S15** Modify-before-approve — granted role/perms may differ from requested; still pass S13–S14

### Access requests

- [x] **S16** Submit request — role and/or custom perms + required justification
- [ ] **S17** One pending — second submit blocked (app + DB)
- [ ] **S18** List for reviewer — filtered by reviewer authority
- [ ] **S19** Approve — applies role/perms immediately; links request id in history
- [ ] **S20** Deny — status + reason; no grant

### Direct grant

- [ ] **S21** Direct role grant — same authority + expiry as approve; no request row required
- [ ] **S22** Direct custom-perm grant — same

### Decision adapters (via existing `decide*` / authorize APIs)

- [ ] **S23** Pending gate — no role ⇒ pending-only (not “no ns membership”)
- [ ] **S24** Instance actions via new perms — create namespace, session, tokens, etc. map to new names
- [ ] **S25** Admin separation — Admin denied on data/audit reads
- [ ] **S26** Auditor ACL bypass — `repo:bypass_acl` allows private repo read without collaborator
- [ ] **S27** Non-auditor repo ACL — still collaborator/ns rules

### Audit

- [ ] **S28** Immudb events — `role.assign` / `role.revoke` / `permission.grant` / `permission.revoke` (+ request id when applicable), via existing audit write/query seam

### HTTP

- [ ] **S29** Access-request routes — submit / list / approve / deny contracts
- [ ] **S30** Direct-grant routes — role + permissions (+ expiry)
- [ ] **S31** `/auth/me/authz` — role, effective perms, pending, catalog (replaces old 8-bool map); wipe old permission APIs here

### Web (MVP)

- [ ] **S32** No-access shell — only Request Access; after submit → pending state, no nav
- [ ] **S33** Request Access form — role radios (External/User/Manager) or custom multi-select + justification
- [ ] **S34** Profile role badge + Permissions tab — checklist + request-additional + pending indicator
- [ ] **S35** Settings → Access Requests — list/filter, detail, modify, approve/deny, authority error
- [ ] **S36** Settings → Users / Grant Access — list + grant modal with expiry + authority validation

**Order:** S01–S03 → S04–S12 → S13–S15 → S16–S20 → S21–S22 → S23–S27 → S28 → S29–S31 → S32–S36

**Protocol per seam:** write failing test → minimal green → commit with message naming the seam (`feat(auth): RBAC S0N …` or `test(auth): RBAC S0N …`) → push.

## Technical Notes

### Permission Catalog Location
- Full permission catalog in `docs/specs/authorization-system.md`
- 150+ permissions across 16 categories
- Extensible design (no schema changes for new permissions)
- Replace `INSTANCE_PERMISSIONS` in auth/web/cli contract in the same workstream (no compatibility aliases)

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
- Requires: #14 expiry semantics (extend to role + custom grants)
- Blocks: User onboarding flow
- Blocks: Team/namespace creation flow
- Blocks: #13 auditor access (consumes `repo:bypass_acl` from this ticket)
- Related: `.specs/02-authorization.md` (update required)
- Related: Issue #04 superseded by this ticket (old remove-workflow plan cancelled)

## References

- Detailed spec: `docs/specs/authorization-system.md`
- Current authorization: `auth/src/authz.ts`
- Current instance permissions: `auth/src/authzInstanceStore.ts`
- Issue #04: Remove old access request workflow (superseded by this ticket)
- Issue #14: Instance permission expiry (keep; apply to new grants)

## Estimated Effort

**5 weeks** (1 developer) — estimate only; delivery is seam-by-seam, not week phases.

## Status

In progress. Next: **S17**.

## Comments

- 2026-11-03: Planned with TDD. Locked wipe cutover, Admin no data access, keep expiry, MVP includes UI. Replaced horizontal Phase 1–10 with seams S01–S36; commit+push after every seam.
- 2026-11-03: S01 done — `auth/src/rbacCatalog.ts` matches spec catalog tables (137 permissions).
- 2026-11-03: S02 done — `auth/src/rbacRoles.ts` role bundles + Admin/Auditor separation.
- 2026-11-03: S03 done — `mergeEffectivePermissions` role ∪ custom, deduped.
- 2026-11-03: S04 done — `principal_roles` + `assignRole` with delegated expiry / bootstrap.
- 2026-11-03: S05 done — replace/revoke roles with append-only `principal_role_history`.
- 2026-11-03: S06 done — expired roles read as none via `getUserRole(now)`.
- 2026-11-03: S07 done — `listRoleHistory` returns ordered grant/revoke rows with reasons.
- 2026-11-03: S08 done — `principal_permissions` + `grantCustomPermissions` with delegated expiry.
- 2026-11-03: S09 done — revoke custom perms + `principal_permission_history`.
- 2026-11-03: S10 done — `getEffectivePermissions` / `hasPermission` over store state.
- 2026-11-03: S11 done — `listPermissionHistory` store seam.
- 2026-11-03: S12 done — `permission_snapshots` on role/perm changes.
- 2026-11-03: S13 done — `canApproveRole` Manager≤Manager, Admin any.
- 2026-11-03: S14 done — `canGrantPermissions` requires reviewer holds every perm.
- 2026-11-03: S15 done — `canApproveModifiedGrant` validates granted (not requested) set.
- 2026-11-03: S16 done — RBAC `submitAccessRequest` with role/perms + justification.
