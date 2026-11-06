# Authorization System Specification

**Version:** 2.0  
**Status:** Design  
**Last Updated:** 2024-01-15

---

## Overview

The authorization system implements role-based access control (RBAC) with granular instance permissions. Users are assigned formal roles that determine their capabilities, and can additionally be granted individual permissions for custom access patterns.

### Design Principles

1. **Role-First**: Primary access control through formal roles (External User, User, Manager, Auditor, Admin)
2. **Maximum Granularity**: Split permissions to the finest-grained operations
3. **Separation of Duties**: Admin manages system but cannot access data/audits (Auditor's domain)
4. **Extensibility**: Permission system designed to add new permissions without schema changes
5. **Audit Trail**: All permission grants, changes, and revocations are versioned and audited
6. **Request-Based Access**: Users request roles/permissions; admins/managers approve

---

## Roles

### Role Definitions

| Role | Code | Description | Access Level |
|------|------|-------------|--------------|
| **External User** | `external` | Read-only external collaborator | Repository data (read) |
| **User** | `user` | Standard user with read/write access | Repository data (read + write) |
| **Manager** | `manager` | Team lead with namespace management | Namespaces + approval authority |
| **Auditor** | `auditor` | Compliance officer with universal read | All data (read, bypass ACLs) |
| **Admin** | `admin` | System administrator | System management (no data access) |

### Role Hierarchy

```
Admin      ──┐
             │ (no hierarchy, separate domains)
Auditor    ──┤
             │
Manager    ──┴── Can approve: External, User, Manager
  │
User       ──── Can approve: None
  │
External   ──── Can approve: None
```

**Note:** Admin and Auditor are separate domains (management vs oversight). Managers can approve requests up to and including Manager role.

---

## Instance Permissions

### Permission Naming Convention

Format: `<resource>:<operation>[:<sub-operation>]`

Examples:
- `namespace:read` - Read namespace details
- `repo:files:read` - Read repository files
- `workspace:lease:acquire` - Acquire workspace lease

### Complete Permission Catalog

#### **1. Namespace Permissions**

| Permission | Description | Operations |
|------------|-------------|------------|
| `namespace:list` | List accessible namespaces | GET `/auth/namespaces` |
| `namespace:read` | View namespace details and members | GET `/auth/namespaces/:ns` |
| `namespace:create` | Create new namespace | POST `/auth/namespaces` |
| `namespace:update` | Update namespace settings | PATCH `/auth/namespaces/:ns` |
| `namespace:delete` | Delete namespace | DELETE `/auth/namespaces/:ns` |
| `namespace:members:list` | List namespace members | GET `/auth/namespaces/:ns` (members field) |
| `namespace:members:add` | Add namespace member | PUT `/auth/namespaces/:ns/members` |
| `namespace:members:update` | Update member role | PUT `/auth/namespaces/:ns/members` |
| `namespace:members:remove` | Remove namespace member | DELETE `/auth/namespaces/:ns/members` |

#### **2. Repository Permissions**

| Permission | Description | Operations |
|------------|-------------|------------|
| `repo:list` | List repositories in namespace | GET `/auth/namespaces` (repos field) |
| `repo:read` | View repository metadata | GET `/auth/namespaces/:ns/repos/:repo` |
| `repo:create` | Create repository | POST `/auth/repos` |
| `repo:update` | Update repository metadata | PATCH `/auth/repos/:ns/:repo` |
| `repo:delete` | Delete repository | DELETE `/auth/repos/:ns/:repo` |
| `repo:files:read` | Read repository files | GET `/api/repos/:ns/:repo/files/*` |
| `repo:files:write` | Write repository files | POST/PUT `/api/repos/:ns/:repo/files/*` |
| `repo:files:delete` | Delete repository files | DELETE `/api/repos/:ns/:repo/files/*` |
| `repo:branches:list` | List branches | GET `/api/repos/:ns/:repo/branches` |
| `repo:branches:create` | Create branch | POST `/api/repos/:ns/:repo/branches` |
| `repo:branches:update` | Update branch | PUT `/api/repos/:ns/:repo/branches/*` |
| `repo:branches:delete` | Delete branch | DELETE `/api/repos/:ns/:repo/branches/*` |
| `repo:commits:list` | List commits | GET `/api/repos/:ns/:repo/commits` |
| `repo:commits:read` | Read commit details | GET `/api/repos/:ns/:repo/commits/:id` |
| `repo:commits:create` | Create commit | POST `/api/repos/:ns/:repo/commits` |
| `repo:tags:list` | List tags | GET `/api/repos/:ns/:repo/tags` |
| `repo:tags:create` | Create tag | POST `/api/repos/:ns/:repo/tags` |
| `repo:tags:delete` | Delete tag | DELETE `/api/repos/:ns/:repo/tags/*` |
| `repo:merge` | Merge branches | POST `/api/repos/:ns/:repo/merge` |
| `repo:collaborators:list` | List repository collaborators | GET `/auth/namespaces/:ns/repos/:repo/collaborators` |
| `repo:collaborators:add` | Add repository collaborator | PUT `/auth/namespaces/:ns/repos/:repo/collaborators` |
| `repo:collaborators:update` | Update collaborator role | PUT `/auth/namespaces/:ns/repos/:repo/collaborators` |
| `repo:collaborators:remove` | Remove repository collaborator | DELETE `/auth/namespaces/:ns/repos/:repo/collaborators` |
| `repo:custom_roles:read` | View custom role definitions | GET `/auth/namespaces/:ns/custom-roles` |
| `repo:custom_roles:create` | Create custom repository role | POST `/auth/namespaces/:ns/custom-roles/repo` |
| `repo:custom_roles:update` | Update custom repository role | PATCH `/auth/namespaces/:ns/custom-roles/repo/:id` |
| `repo:custom_roles:delete` | Delete custom repository role | DELETE `/auth/namespaces/:ns/custom-roles/repo/:id` |
| `repo:bypass_acl` | Bypass repository ACLs (read-only) | All read operations, ignore collaborator checks |

#### **3. Session Permissions**

| Permission | Description | Operations |
|------------|-------------|------------|
| `session:list` | List desktop sessions | GET `/auth/sessions` |
| `session:read` | View session details | GET `/auth/sessions/:id` |
| `session:create` | Create new desktop session | POST `/auth/sessions` |
| `session:connect` | Connect to session | POST `/auth/sessions/:id/connect` |
| `session:control` | Control session (stop/disconnect/retry) | POST `/auth/sessions/:id/{stop,disconnect,retry}` |
| `session:remount` | Remount workspace in session | POST `/auth/sessions/:id/remount` |
| `session:update` | Update session mounts | PUT `/auth/sessions/:id/mounts` |
| `session:delete` | Destroy session | DELETE `/auth/sessions/:id` |
| `session:token:read` | Get connect token | GET `/auth/sessions/:id/connect-token` |
| `session:retention:read` | View retention policy | GET `/auth/sessions/retention` |
| `session:templates:list` | List session templates | GET `/auth/sessions/templates` |

#### **4. Workspace Permissions**

| Permission | Description | Operations |
|------------|-------------|------------|
| `workspace:list` | List workspaces | GET `/auth/workspaces` |
| `workspace:read` | View workspace details | GET `/auth/workspaces/:id` |
| `workspace:create` | Create workspace | POST `/auth/workspaces` |
| `workspace:update` | Update workspace | PATCH `/auth/workspaces/:id` |
| `workspace:delete` | Delete workspace | DELETE `/auth/workspaces/:id` |
| `workspace:files:list` | List workspace files | GET `/auth/workspaces/:id/files/*` |
| `workspace:files:read` | Read workspace file | GET `/auth/workspaces/:id/files/*` |
| `workspace:files:write` | Write workspace file | PUT `/auth/workspaces/:id/files/*` |
| `workspace:files:delete` | Delete workspace file | DELETE `/auth/workspaces/:id/files/*` |
| `workspace:changes:read` | View workspace changes | GET `/auth/workspaces/:id/changes` |
| `workspace:archive:download` | Download workspace archive | GET `/auth/workspaces/:id/archive` |
| `workspace:retry` | Retry failed workspace build | POST `/auth/workspaces/:id/retry` |
| `workspace:lease:list` | List workspace leases | GET `/auth/workspaces/:id/leases` |
| `workspace:lease:acquire` | Acquire workspace lease | POST `/auth/workspaces/:id/leases` |
| `workspace:lease:renew` | Renew workspace lease | POST `/auth/workspaces/:id/leases/:leaseId/renew` |
| `workspace:lease:release` | Release workspace lease | DELETE `/auth/workspaces/:id/leases/:leaseId` |
| `workspace:lease:mount` | Get lease mount spec | POST `/auth/workspaces/:id/leases/:leaseId/mount` |
| `workspace:capabilities:read` | View workspace capabilities | GET `/auth/workspaces/capabilities` |

#### **5. Checkout Permissions**

| Permission | Description | Operations |
|------------|-------------|------------|
| `checkout:list` | List checkouts | GET `/auth/checkouts` |
| `checkout:read` | View checkout status | GET `/auth/checkouts/:ns/:repo/:commit` |
| `checkout:create` | Create checkout | POST `/auth/checkouts` |
| `checkout:delete` | Evict checkout (admin) | DELETE `/auth/checkouts/:ns/:repo/:commit` |

#### **6. Job Permissions**

| Permission | Description | Operations |
|------------|-------------|------------|
| `job:list` | List jobs | GET `/auth/jobs` |
| `job:read` | View job details | GET `/auth/jobs/:id` |
| `job:logs:read` | View job logs | GET `/auth/jobs/:id/logs` |
| `job:submit` | Submit job | POST `/auth/jobs` |
| `job:cancel` | Cancel job | POST `/auth/jobs/:id/cancel` |
| `job:complete` | Mark job complete | POST `/auth/jobs/:id/complete` |
| `job:publish` | Publish synced CLI jobs | POST `/auth/jobs/publish` |

#### **7. Audit & Lineage Permissions**

| Permission | Description | Operations |
|------------|-------------|------------|
| `audit:read` | Query audit logs | GET `/auth/audit` |
| `audit:facets:read` | Get audit filter facets | GET `/auth/audit/facets` |
| `audit:export:csv` | Export audit as CSV | GET `/auth/audit/export.csv` |
| `audit:export:bundle` | Export evidence bundle | GET `/auth/audit/export.bundle` |
| `audit:acknowledge` | Acknowledge audit chain break | POST `/auth/audit/acknowledge` |
| `lineage:read` | Query file lineage | GET `/auth/lineage` |
| `lineage:rebuild` | Rebuild lineage from history | POST `/auth/lineage/rebuild` |

#### **8. Metadata Permissions**

| Permission | Description | Operations |
|------------|-------------|------------|
| `metadata:read` | Read entity metadata | GET `/auth/meta` |
| `metadata:batch:read` | Bulk read metadata | POST `/auth/meta/batch` |
| `metadata:create` | Create metadata | PUT `/auth/meta` |
| `metadata:update` | Update metadata | PUT `/auth/meta` |
| `metadata:patch` | Patch metadata | PATCH `/auth/meta` |
| `metadata:delete` | Delete metadata | DELETE `/auth/meta` |
| `metadata:history:read` | View metadata history | GET `/auth/meta/history` |
| `metadata:search` | Search metadata | GET `/auth/meta/search` |

#### **9. Favorites Permissions**

| Permission | Description | Operations |
|------------|-------------|------------|
| `favorites:list` | List user's favorites | GET `/auth/favorites` |
| `favorites:add` | Add favorite | PUT `/auth/favorites` |
| `favorites:remove` | Remove favorite | DELETE `/auth/favorites` |
| `favorites:lookup` | Bulk membership check | POST `/auth/favorites/lookup` |

#### **10. Authentication & Identity Permissions**

| Permission | Description | Operations |
|------------|-------------|------------|
| `auth_events:read` | View own authentication events | GET `/auth/me/events` |
| `tokens:list` | List own device tokens | GET `/auth/me/tokens` |
| `tokens:create` | Create device token (via device flow) | POST `/auth/cli/device/*` |
| `tokens:revoke` | Revoke own device token | DELETE `/auth/me/tokens/:id` |
| `directory:search` | Search directory for users/groups | GET `/auth/directory/search` |

#### **11. Access Management Permissions**

| Permission | Description | Operations |
|------------|-------------|------------|
| `access_request:submit` | Submit access request | POST `/auth/access-requests` |
| `access_request:list` | List access requests (reviewers) | GET `/auth/access-requests` |
| `access_request:review` | Approve/deny access requests | POST `/auth/access-requests/:id` |
| `cli_device:approve` | Approve CLI device authorization | POST `/auth/cli/device/approve` |
| `cli_device:deny` | Deny CLI device authorization | POST `/auth/cli/device/deny` |

#### **12. Instance Admin Permissions**

| Permission | Description | Operations |
|------------|-------------|------------|
| `instance:settings:read` | View instance settings | GET `/auth/instance` |
| `instance:settings:update` | Update instance settings | PATCH `/auth/instance` |
| `instance:admins:list` | List instance admins | GET `/auth/instance` (admins field) |
| `instance:permissions:list` | List permission grants | GET `/auth/instance` (permissions field) |
| `instance:permissions:grant` | Grant instance permissions | PUT `/auth/instance/permissions` |
| `instance:permissions:revoke` | Revoke instance permissions | DELETE `/auth/instance/permissions` |

#### **13. Announcement Permissions**

| Permission | Description | Operations |
|------------|-------------|------------|
| `announcements:list` | List announcements | GET `/auth/announcements` |
| `announcements:create` | Create announcement | POST `/auth/announcements` |
| `announcements:update` | Update announcement | PATCH `/auth/announcements/:id` |
| `announcements:delete` | Delete announcement | DELETE `/auth/announcements/:id` |

#### **14. User Management Permissions**

| Permission | Description | Operations |
|------------|-------------|------------|
| `users:sessions:revoke` | Revoke user sessions | POST `/auth/instance/revoke-sessions` |
| `users:suspend` | Initiate user suspension | POST `/auth/admin/suspend` |
| `users:suspend:confirm` | Confirm user suspension | POST `/auth/admin/suspend/:id/confirm` |
| `users:suspensions:list` | List pending suspensions | GET `/auth/admin/suspensions/pending` |

#### **15. Security Admin Permissions**

| Permission | Description | Operations |
|------------|-------------|------------|
| `idp_baseline:check` | Trigger IdP MFA check | POST `/auth/admin/idp-baseline/check` |
| `idp_baseline:status:read` | View baseline status | GET `/auth/admin/idp-baseline/status` |
| `idp_baseline:history:read` | View baseline history | GET `/auth/admin/idp-baseline/history` |
| `idp_drift:baseline:read` | View baseline configuration | GET `/auth/admin/idp-drift/baseline` |
| `idp_drift:current:read` | View current IdP config | GET `/auth/admin/idp-drift/current` |
| `idp_drift:compare` | Compare baseline vs current | GET `/auth/admin/idp-drift/compare` |
| `idp_drift:check` | Perform drift check | POST `/auth/admin/idp-drift/check` |
| `idp_drift:reports:read` | View drift reports | GET `/auth/admin/idp-drift/reports` |
| `idp_drift:baseline:establish` | Establish new baseline | POST `/auth/admin/idp-drift/baseline` |
| `seal_keys:list` | List seal keys | GET `/auth/admin/seal-keys` |
| `seal_keys:current:read` | View current seal key | GET `/auth/admin/seal-keys/current` |
| `seal_keys:rotate` | Rotate seal keys | POST `/auth/admin/seal-keys/rotate` |
| `seal_keys:rotate:emergency` | Emergency key rotation | POST `/auth/admin/seal-keys/rotate/emergency` |

#### **16. Store Admin Permissions**

| Permission | Description | Operations |
|------------|-------------|------------|
| `store:gc` | Run garbage collection | POST `/auth/store/gc` |
| `store:scrub` | Run scrub operation | POST `/auth/store/scrub` |

---

## Role Permission Mappings

### External User

**Purpose:** Read-only external collaborator

```typescript
const EXTERNAL_USER_PERMISSIONS = [
  // Namespace & Repository (read)
  'namespace:list',
  'namespace:read',
  'repo:list',
  'repo:read',
  'repo:files:read',
  'repo:branches:list',
  'repo:commits:list',
  'repo:commits:read',
  'repo:tags:list',
  'repo:collaborators:list',
  'repo:custom_roles:read',
  
  // Sessions & Workspaces (read)
  'session:list',
  'session:read',
  'session:templates:list',
  'workspace:list',
  'workspace:read',
  'workspace:files:list',
  'workspace:files:read',
  'workspace:changes:read',
  'checkout:list',
  'checkout:read',
  
  // Jobs (read)
  'job:list',
  'job:read',
  'job:logs:read',
  
  // Metadata & Favorites (read)
  'metadata:read',
  'metadata:batch:read',
  'metadata:history:read',
  'metadata:search',
  'favorites:list',
  'favorites:lookup',
  
  // Identity
  'auth_events:read',
  'tokens:list',
  'tokens:create',
  'tokens:revoke',
]
```

### User

**Purpose:** Standard user with read/write access

```typescript
const USER_PERMISSIONS = [
  ...EXTERNAL_USER_PERMISSIONS,
  
  // Repository (write)
  'repo:files:write',
  'repo:files:delete',
  'repo:branches:create',
  'repo:branches:update',
  'repo:branches:delete',
  'repo:commits:create',
  'repo:tags:create',
  'repo:tags:delete',
  'repo:merge',
  
  // Sessions (connect & control)
  'session:connect',
  'session:control',
  'session:token:read',
  
  // Workspaces (write)
  'workspace:files:write',
  'workspace:files:delete',
  'workspace:archive:download',
  'workspace:lease:list',
  'workspace:lease:acquire',
  'workspace:lease:renew',
  'workspace:lease:release',
  'workspace:lease:mount',
  'checkout:create',
  
  // Jobs (submit & cancel)
  'job:submit',
  'job:cancel',
  
  // Metadata & Favorites (write)
  'metadata:create',
  'metadata:update',
  'metadata:patch',
  'metadata:delete',
  'favorites:add',
  'favorites:remove',
  
  // Access
  'access_request:submit',
]
```

### Manager

**Purpose:** Team lead with namespace management and approval authority

```typescript
const MANAGER_PERMISSIONS = [
  ...USER_PERMISSIONS,
  
  // Namespace management
  'namespace:create',
  'namespace:update',
  'namespace:delete',
  'namespace:members:list',
  'namespace:members:add',
  'namespace:members:update',
  'namespace:members:remove',
  
  // Repository management
  'repo:create',
  'repo:update',
  'repo:delete',
  'repo:collaborators:add',
  'repo:collaborators:update',
  'repo:collaborators:remove',
  'repo:custom_roles:create',
  'repo:custom_roles:update',
  'repo:custom_roles:delete',
  
  // Sessions (full control)
  'session:create',
  'session:remount',
  'session:update',
  'session:delete',
  'session:retention:read',
  
  // Workspaces (full control)
  'workspace:create',
  'workspace:update',
  'workspace:delete',
  'workspace:retry',
  'workspace:capabilities:read',
  
  // Jobs (complete)
  'job:complete',
  'job:publish',
  
  // Audit & Lineage
  'audit:read',
  'audit:facets:read',
  'audit:export:csv',
  'audit:export:bundle',
  'lineage:read',
  'lineage:rebuild',
  
  // Access management (up to Manager level)
  'access_request:list',
  'access_request:review',
  'cli_device:approve',
  'cli_device:deny',
  'directory:search',
  
  // Announcements (read)
  'announcements:list',
]
```

### Auditor

**Purpose:** Compliance officer with universal read access (bypass ACLs)

```typescript
const AUDITOR_PERMISSIONS = [
  // Namespace & Repository (read all, bypass ACLs)
  'namespace:list',
  'namespace:read',
  'namespace:members:list',
  'repo:list',
  'repo:read',
  'repo:files:read',
  'repo:branches:list',
  'repo:commits:list',
  'repo:commits:read',
  'repo:tags:list',
  'repo:collaborators:list',
  'repo:custom_roles:read',
  'repo:bypass_acl', // Special: bypass all repository ACL checks
  
  // Sessions & Workspaces (read all)
  'session:list',
  'session:read',
  'session:templates:list',
  'session:retention:read',
  'workspace:list',
  'workspace:read',
  'workspace:files:list',
  'workspace:files:read',
  'workspace:changes:read',
  'workspace:archive:download',
  'workspace:lease:list',
  'workspace:capabilities:read',
  'checkout:list',
  'checkout:read',
  
  // Jobs (read all)
  'job:list',
  'job:read',
  'job:logs:read',
  
  // Audit & Lineage (full access)
  'audit:read',
  'audit:facets:read',
  'audit:export:csv',
  'audit:export:bundle',
  'lineage:read',
  
  // Metadata (read)
  'metadata:read',
  'metadata:batch:read',
  'metadata:history:read',
  'metadata:search',
  
  // Announcements (read)
  'announcements:list',
  
  // Identity
  'auth_events:read',
  'tokens:list',
  'tokens:create',
  'tokens:revoke',
]
```

### Admin

**Purpose:** System administrator (manages system, NO data/audit access)

```typescript
const ADMIN_PERMISSIONS = [
  // Instance management
  'instance:settings:read',
  'instance:settings:update',
  'instance:admins:list',
  'instance:admins:add',
  'instance:admins:remove',
  'instance:permissions:list',
  'instance:permissions:grant',
  'instance:permissions:revoke',
  
  // User management
  'users:sessions:revoke',
  'users:suspend',
  'users:suspend:confirm',
  'users:suspensions:list',
  
  // Security administration
  'idp_baseline:check',
  'idp_baseline:status:read',
  'idp_baseline:history:read',
  'idp_drift:baseline:read',
  'idp_drift:current:read',
  'idp_drift:compare',
  'idp_drift:check',
  'idp_drift:reports:read',
  'idp_drift:baseline:establish',
  'seal_keys:list',
  'seal_keys:current:read',
  'seal_keys:rotate',
  'seal_keys:rotate:emergency',
  
  // Announcements
  'announcements:list',
  'announcements:create',
  'announcements:update',
  'announcements:delete',
  
  // Access management (all roles)
  'access_request:list',
  'access_request:review',
  'directory:search',
  
  // Store administration
  'store:gc',
  'store:scrub',
  'checkout:delete',
  
  // Audit admin (NOT reading audit data)
  'audit:acknowledge',
  
  // Identity (own tokens only)
  'tokens:list',
  'tokens:create',
  'tokens:revoke',
]
```

---

## Database Schema

### Principals & Roles

```sql
-- Principal (authenticated user/service)
CREATE TABLE principals (
  id SERIAL PRIMARY KEY,
  iss TEXT NOT NULL,           -- OIDC issuer
  sub TEXT NOT NULL,           -- OIDC subject
  name TEXT NOT NULL,          -- Display name
  email TEXT,                  -- Email address
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(iss, sub)
);

-- Principal role assignment (current active role)
CREATE TABLE principal_roles (
  principal_id INT PRIMARY KEY REFERENCES principals(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('external', 'user', 'manager', 'auditor', 'admin')),
  granted_at TIMESTAMP NOT NULL DEFAULT NOW(),
  granted_by INT REFERENCES principals(id),
  grant_reason TEXT
);

-- Principal role history (all role changes, immutable audit trail)
CREATE TABLE principal_role_history (
  id SERIAL PRIMARY KEY,
  principal_id INT NOT NULL REFERENCES principals(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('external', 'user', 'manager', 'auditor', 'admin')),
  action VARCHAR(20) NOT NULL CHECK (action IN ('granted', 'revoked', 'upgraded', 'downgraded')),
  granted_at TIMESTAMP NOT NULL DEFAULT NOW(),
  granted_by INT REFERENCES principals(id),
  revoked_at TIMESTAMP,
  revoked_by INT REFERENCES principals(id),
  grant_reason TEXT,
  revoke_reason TEXT,
  access_request_id UUID REFERENCES access_requests(id)
);
CREATE INDEX idx_principal_role_history_principal ON principal_role_history(principal_id, granted_at DESC);
CREATE INDEX idx_principal_role_history_granted_by ON principal_role_history(granted_by);
```

### Custom Permissions

```sql
-- Custom instance permissions (beyond role defaults)
CREATE TABLE principal_permissions (
  id SERIAL PRIMARY KEY,
  principal_id INT NOT NULL REFERENCES principals(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,    -- e.g., 'namespace:create'
  granted_at TIMESTAMP NOT NULL DEFAULT NOW(),
  granted_by INT REFERENCES principals(id),
  grant_reason TEXT,
  UNIQUE(principal_id, permission)
);

-- Permission grant history (all permission changes, immutable audit trail)
CREATE TABLE principal_permission_history (
  id SERIAL PRIMARY KEY,
  principal_id INT NOT NULL REFERENCES principals(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  action VARCHAR(20) NOT NULL CHECK (action IN ('granted', 'revoked')),
  granted_at TIMESTAMP NOT NULL DEFAULT NOW(),
  granted_by INT REFERENCES principals(id),
  revoked_at TIMESTAMP,
  revoked_by INT REFERENCES principals(id),
  grant_reason TEXT,
  revoke_reason TEXT,
  access_request_id UUID REFERENCES access_requests(id)
);
CREATE INDEX idx_principal_permission_history_principal ON principal_permission_history(principal_id, granted_at DESC);
CREATE INDEX idx_principal_permission_history_granted_by ON principal_permission_history(granted_by);
```

### Access Requests

```sql
-- Access request status
CREATE TYPE access_request_status AS ENUM ('pending', 'approved', 'denied', 'cancelled');

-- Access request type
CREATE TYPE access_request_type AS ENUM ('initial', 'upgrade', 'additional');

-- Access requests
CREATE TABLE access_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id INT NOT NULL REFERENCES principals(id) ON DELETE CASCADE,
  status access_request_status NOT NULL DEFAULT 'pending',
  request_type access_request_type NOT NULL,
  
  -- What was requested
  requested_role VARCHAR(20) CHECK (requested_role IN ('external', 'user', 'manager', 'auditor', 'admin')),
  requested_permissions TEXT[],  -- Custom permissions
  request_message TEXT,          -- User's justification
  
  -- Request metadata
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  
  -- Review metadata
  reviewed_by INT REFERENCES principals(id),
  reviewed_at TIMESTAMP,
  approval_reason TEXT,          -- Admin's reason (optional)
  
  -- What was actually granted (may differ from requested)
  granted_role VARCHAR(20) CHECK (granted_role IN ('external', 'user', 'manager', 'auditor', 'admin')),
  granted_permissions TEXT[],
  
  CONSTRAINT request_must_have_role_or_perms CHECK (
    requested_role IS NOT NULL OR 
    (requested_permissions IS NOT NULL AND array_length(requested_permissions, 1) > 0)
  ),
  CONSTRAINT approval_must_have_reviewer CHECK (
    (status = 'approved' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL) OR
    (status != 'approved')
  )
);

CREATE INDEX idx_access_requests_principal ON access_requests(principal_id, created_at DESC);
CREATE INDEX idx_access_requests_status ON access_requests(status, created_at DESC);
CREATE INDEX idx_access_requests_reviewed_by ON access_requests(reviewed_by);

-- Ensure only one pending request per principal at a time
CREATE UNIQUE INDEX idx_access_requests_one_pending_per_principal 
  ON access_requests(principal_id) 
  WHERE status = 'pending';
```

### Permission Snapshots

```sql
-- Periodic snapshots of effective permissions for audit/compliance
CREATE TABLE permission_snapshots (
  id SERIAL PRIMARY KEY,
  principal_id INT NOT NULL REFERENCES principals(id) ON DELETE CASCADE,
  snapshot_at TIMESTAMP NOT NULL DEFAULT NOW(),
  role VARCHAR(20),
  custom_permissions TEXT[],
  effective_permissions TEXT[],  -- Computed: role permissions + custom permissions
  snapshot_reason TEXT           -- 'periodic', 'role_change', 'permission_grant', etc.
);
CREATE INDEX idx_permission_snapshots_principal ON permission_snapshots(principal_id, snapshot_at DESC);
```

---

## Authorization Flow

### 1. User Login (No Access)

```
┌─────────────┐
│ User logs in│
│ via SSO     │
└──────┬──────┘
       │
       v
┌─────────────────────┐
│ Check principal_    │
│ roles table         │
└──────┬──────────────┘
       │
       │ No role?
       v
┌─────────────────────┐
│ Show "Request       │
│ Access" UI only     │
│ (no navigation)     │
└─────────────────────┘
```

### 2. Access Request Submission

```
┌──────────────────┐
│ User selects:    │
│ - Role template  │
│ - Or custom perms│
│ - Justification  │
└────────┬─────────┘
         │
         v
┌────────────────────┐
│ Create access_     │
│ requests record    │
│ status='pending'   │
└────────┬───────────┘
         │
         v
┌────────────────────┐
│ Show "Pending"     │
│ state (no access)  │
└────────────────────┘
```

### 3. Access Request Review (Manager/Admin)

```
┌──────────────────────┐
│ Reviewer goes to     │
│ Settings → Requests  │
└──────────┬───────────┘
           │
           v
┌──────────────────────┐
│ List pending requests│
│ (filtered by level)  │
└──────────┬───────────┘
           │
           v
┌──────────────────────────┐
│ Review request:          │
│ - View requested role    │
│ - View custom perms      │
│ - Can modify before      │
│   approval               │
│ - Validate: reviewer has │
│   authority for role     │
└──────────┬───────────────┘
           │
           v
    ┌──────┴──────┐
    │             │
    v             v
┌────────┐   ┌─────────┐
│ Approve│   │ Deny    │
└────┬───┘   └────┬────┘
     │            │
     v            v
┌─────────────────────────┐
│ Record in:              │
│ - access_requests       │
│   (reviewed_at, reason) │
│ - principal_roles       │
│   (if role granted)     │
│ - principal_permissions │
│   (if perms granted)    │
│ - *_history tables      │
│ - Audit trail (immudb)  │
└─────────────────────────┘
```

### 4. Direct Grant (Admin/Manager)

```
┌──────────────────────┐
│ Admin goes to        │
│ Settings → Users     │
└──────────┬───────────┘
           │
           v
┌──────────────────────┐
│ Select user          │
│ Grant role/perms     │
│ (no request needed)  │
└──────────┬───────────┘
           │
           v
┌─────────────────────────┐
│ Record in:              │
│ - principal_roles       │
│ - principal_permissions │
│ - *_history tables      │
│ - Audit trail (immudb)  │
│ (same as approval flow) │
└─────────────────────────┘
```

### 5. Permission Check (Runtime)

```
┌──────────────────────┐
│ API request received │
└──────────┬───────────┘
           │
           v
┌──────────────────────────┐
│ Extract principal from   │
│ session/PAT token        │
└──────────┬───────────────┘
           │
           v
┌──────────────────────────────┐
│ Get effective permissions:   │
│ 1. Load role from            │
│    principal_roles           │
│ 2. Get role's default perms  │
│ 3. Load custom perms from    │
│    principal_permissions     │
│ 4. Merge: role + custom      │
└──────────┬───────────────────┘
           │
           v
┌──────────────────────────────┐
│ Check required permission:   │
│ - repo:read                  │
│ - namespace:create           │
│ - etc.                       │
└──────────┬───────────────────┘
           │
     ┌─────┴─────┐
     │           │
     v           v
┌─────────┐ ┌─────────┐
│ Allow   │ │ Deny    │
└─────────┘ └─────────┘
```

### 6. Additional Permission Request (Existing User)

```
┌──────────────────────┐
│ User goes to         │
│ Profile → Perms      │
└──────────┬───────────┘
           │
           v
┌──────────────────────────┐
│ "Request Additional      │
│  Permissions" button     │
└──────────┬───────────────┘
           │
           v
┌──────────────────────────────┐
│ Select additional:           │
│ - Role upgrade               │
│   (User → Manager)           │
│ - Or specific permissions    │
└──────────┬───────────────────┘
           │
           v
┌────────────────────────────────┐
│ Create access_requests record  │
│ type='upgrade' or 'additional' │
│ (same approval flow as #3)     │
└────────────────────────────────┘
```

---

## Manager Approval Authority

### Approval Rules

| Reviewer Role | Can Approve |
|--------------|-------------|
| **Manager** | External User, User, Manager |
| **Admin** | External User, User, Manager, Auditor, Admin |

### Permission Validation

When reviewing request:

```typescript
function canApproveRequest(reviewer: Principal, request: AccessRequest): boolean {
  // Get reviewer's role
  const reviewerRole = reviewer.role
  const requestedRole = request.requested_role
  
  // Admin can approve anything
  if (reviewerRole === 'admin') {
    return true
  }
  
  // Manager can approve up to Manager level
  if (reviewerRole === 'manager') {
    return ['external', 'user', 'manager'].includes(requestedRole)
  }
  
  // Others cannot approve
  return false
}

function canGrantPermissions(reviewer: Principal, permissions: string[]): boolean {
  const reviewerPerms = getEffectivePermissions(reviewer)
  
  // Reviewer must have ALL requested permissions themselves
  return permissions.every(p => reviewerPerms.includes(p))
}
```

### Approval Block

If manager tries to approve permissions they don't have:

```
❌ Cannot approve request

You do not have the following permissions:
- audit:read
- lineage:rebuild

Contact an administrator to approve this request.
```

---

## Audit Trail

### What Gets Audited

Every permission change is recorded in **two places**:

1. **PostgreSQL** (queryable history tables)
   - `principal_role_history`
   - `principal_permission_history`
   - `access_requests` (with full review metadata)

2. **Immudb** (immutable audit trail)
   - Action: `permission.grant`, `permission.revoke`, `role.assign`, `role.revoke`
   - Actor: Who made the change
   - Subject: Who was affected
   - Reason: Admin's justification
   - Request: Link to access request (if applicable)
   - Diff: What changed (before/after)

### Audit Event Schema

```json
{
  "action": "role.assign",
  "actor": {
    "sub": "admin_user_sub",
    "iss": "http://keycloak:8080/realms/mice",
    "email": "admin@mice.com"
  },
  "subject": {
    "sub": "target_user_sub",
    "iss": "http://keycloak:8080/realms/mice",
    "email": "user@mice.com"
  },
  "timestamp": "2024-01-15T10:30:00Z",
  "role": "manager",
  "previous_role": "user",
  "reason": "Promoted to team lead",
  "access_request_id": "550e8400-e29b-41d4-a716-446655440000",
  "ip_address": "192.168.1.100",
  "user_agent": "Mozilla/5.0..."
}
```

---

## Extensibility

### Adding New Permissions

1. **Add to permission catalog** (this document)
2. **Map to API endpoints** in authorization middleware
3. **Update role mappings** if new permission should be in a role
4. **No database migration required** - permissions are TEXT[] fields

Example:

```typescript
// Add new permission
export const NEW_PERMISSIONS = [
  'repo:webhooks:create',
  'repo:webhooks:update',
  'repo:webhooks:delete',
] as const

// Update role mapping
const MANAGER_PERMISSIONS = [
  ...EXISTING_MANAGER_PERMISSIONS,
  'repo:webhooks:create',
  'repo:webhooks:update',
  'repo:webhooks:delete',
]

// Use in authorization check
if (!hasPermission(user, 'repo:webhooks:create')) {
  return forbidden('Missing permission: repo:webhooks:create')
}
```

### Permission Namespaces

Permissions follow hierarchical naming:

- `<resource>:<operation>` - Top-level operation
- `<resource>:<sub-resource>:<operation>` - Nested resource
- `<resource>:<sub-resource>:<sub-operation>` - Specific operation

This allows future **wildcard permissions**:

- `repo:*` - All repo operations
- `repo:files:*` - All file operations
- `*:read` - All read operations (future consideration)

---

## Migration Notes

**This is a greenfield project**, so no migration from existing system is needed.

### Implementation Order

1. ✅ Create database schema (tables, indexes, constraints)
2. ✅ Implement role assignment functions
3. ✅ Implement permission checking functions
4. ✅ Update all API endpoints with new authorization middleware
5. ✅ Build "Request Access" UI
6. ✅ Build "Review Requests" UI
7. ✅ Build "Direct Grant" UI in Settings
8. ✅ Add audit trail hooks
9. ✅ Create permission snapshot job (periodic)
10. ✅ Update developer seed scripts with roles

---

## Testing Strategy

### Test Accounts

| Account | Role | Purpose |
|---------|------|---------|
| `mice_admin@mice.com` | `admin` | Instance administrator (bootstrap) |
| `mice_manager@mice.com` | `manager` | Team manager / access-request review |
| `mice_auditor@mice.com` | `auditor` | Compliance auditor |
| `mice_user@mice.com` | `user` | Standard user |
| `mice_external@mice.com` | `external` | External collaborator |
| `mice_pending@mice.com` | (none) | No role — `/pending` request flow |

### Test Scenarios

1. **Pending user** requests User role → approved → can write
2. **User** requests Manager role → approved → can create namespace
3. **Manager** requests permissions they don't have → **blocked**
4. **Admin** directly grants Auditor role → user can read all repos (bypass ACL)
5. **User** requests custom permissions → approved with modifications
6. **Manager A** reviews **Manager B** request → **allowed**
7. **Manager** tries to approve **Admin** request → **blocked**
8. **Auditor** reads private repo without collaborator access → **allowed**
9. **Admin** tries to read audit logs → **denied** (no `audit:read` permission)
10. Permission change → recorded in both PostgreSQL and Immudb

---

## Security Considerations

1. **Separation of Duties**: Admin cannot access data/audits (Auditor's domain)
2. **Least Privilege**: Users start with no access, must request what they need
3. **Approval Authority**: Managers can only approve what they themselves have
4. **Audit Immutability**: All changes recorded in immudb (tamper-proof)
5. **Version History**: Complete history of all permission changes in PostgreSQL
6. **One Pending Request**: Users cannot spam requests (one at a time)
7. **Approval Reason**: Optional but encouraged for compliance

---

## Future Enhancements

1. **Time-bound Permissions**: Auto-expire after N days
2. **Conditional Permissions**: Based on MFA, IP range, time of day
3. **Permission Groups**: Bundle related permissions
4. **Delegation**: Managers delegate subset of their perms to others
5. **Emergency Access**: Break-glass with mandatory audit trail
6. **Permission Templates**: Pre-defined bundles beyond roles
7. **Wildcard Permissions**: `repo:*`, `*:read`, etc.
8. **API Scopes**: OAuth-style scopes for PATs
9. **Permission Analytics**: Most requested, most denied, etc.
10. **Automated Approval**: Based on rules (e.g., auto-approve External for public repos)

---

## References

- API Endpoint Audit: See task output above
- Current Authorization: `auth/src/authz.ts`
- Current Instance Permissions: `auth/src/authzInstanceStore.ts`
- Audit Trail: `auth/src/auditRoutes.ts`
- Access Requests (current): `auth/src/authentication/access/`

---

**Document Version History:**

- 2.0 (2024-01-15): Complete redesign with role-based access control, maximum granularity
- 1.0 (Previous): Original instance permission system
