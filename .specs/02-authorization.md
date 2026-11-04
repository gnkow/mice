Status: ready-for-agent

# 02 — Authorization (PLAT-AUTHO)

## Problem Statement

Every request to oxen-server and to Mice features must be allowed or denied by a clear role model, with default-deny, so that scientists see only what they should.

## Solution

The BFF implements role-based access control (RBAC) with 5 formal roles (External User, User, Manager, Auditor, Admin), each with a defined permission bundle. Users request roles or custom permissions through a structured workflow. Managers and admins approve requests up to their authority level. All permission changes are versioned in PostgreSQL and audited in immudb. Resources are keyed by stable entity IDs. Instance admins manage the platform but have NO data access. Auditors have universal read access (bypass ACLs) but cannot write.

## User Stories

1. As a repository admin, I want to grant read, write, maintain or admin to users and groups, so that access is least-privilege.
2. As a namespace owner, I want namespace roles to flow to repositories, so that I manage access once.
3. As an instance admin, I want custom roles built from an action catalog, so that I model our organisation.
4. As an instance admin, I want delegated instance permissions, so that I can split admin duties.
5. As a security reviewer, I want unclassified routes denied, so that new oxen endpoints are never open by accident.
6. As a developer, I want a test that the path map and the role checks agree, so that they cannot drift.
7. As a user, I want a denied request to explain what permission is missing without leaking resource existence, so that I can ask for access.
8. As an auditor, I want every grant, revoke and role change audited, so that access history is reconstructable.
9. As a CLI user, I want device flow authentication with full user permissions.
10. As an instance admin, I want Jobs to run under BFF-internal tokens governed by the submitting user's permissions, so that automation is controlled without service principals.
11. As a developer, I want `stage.*` action names from day one, so that no legacy names or aliases exist.
12. As a user of a renamed repository, I want my access unchanged, so that renames are not a permissions event.
13. As an instance admin, I want to see why an access decision was made, so that I can debug.
14. **As a new user with no access, I want to request a role, so that I can gain appropriate access.**
15. **As a manager, I want to review and approve access requests up to my permission level, so that I can onboard team members.**
16. **As an auditor, I want to read all data bypassing repository ACLs, so that I can perform compliance reviews.**
17. **As an admin, I want to manage the system but NOT access data/audits, so that separation of duties is enforced.**

## Implementation Decisions

### Core Authorization Model

- **Default-deny**: Every unclassified route is denied. ADR 0002 updated. Parity test fails on any new route.
- **Stable entity IDs**: All entities (repositories, namespaces) referenced by UUIDs. Grants, audit, favorites, metadata key by ID not name. Greenfield implementation (no migration).
- **Authorization always enforced**: `AUTHZ_ENFORCE` flag removed. Authorization is always on.
- **Role-based access control**: 5 formal roles with defined permission bundles (External User, User, Manager, Auditor, Admin).
- **Request/approval workflow**: Users request roles or permissions. Managers/admins approve up to their authority level.
- **Instance admin separation**: Instance admins manage platform (settings, users) but have NO data/audit access. Cannot be namespace members.
- **Auditor bypass**: Auditors have `repo:bypass_acl` permission for universal read access (compliance reviews).
- **Manager approval authority**: Managers can approve requests up to Manager level. Cannot approve what they don't have.

### Identity and Groups

- **Group binding**: Groups bound on IdP group ID + issuer (Azure AD GUIDs, Keycloak IDs), not names. Display name cache for UI. Groups re-checked per authentication spec (login, refresh, privileged operations).
- **Principals**: Keyed by `iss|sub` (ADR 0001). No cross-IdP merging.
- **Group validation**: Admin settings check validates IdP provides group IDs. Missing group IDs trigger warning.

### Credentials and Authentication

- **Device flow only**: CLI uses device flow with short-lived tokens (full user permissions, no scoping). Stored in OS keychain.
- **No PATs**: Long-lived Personal Access Tokens completely removed from code (table, routes, UI, permissions, auth logic).
- **No service principals**: Service principals removed. Jobs use BFF-internal tokens tied to submitting user.
- **No scope narrowing**: Device flow tokens have user's full permissions (no namespace/repo scoping, no maxRole).

### Roles and Permissions

#### Instance Roles (RBAC)

- **5 formal roles**: External User, User, Manager, Auditor, Admin
- **Role-based permissions**: Each role has a defined permission bundle (137 granular permissions)
- **Permission extensibility**: Permissions stored as text values (no schema changes for new permissions)
- **Custom permissions**: Users can have role + additional custom permissions beyond role defaults
- **Permission naming**: `<resource>:<sub-resource>:<operation>` (e.g., `repo:files:read`, `workspace:lease:acquire`)
- **Maximum granularity**: Split permissions to finest-grained operations (read vs write vs delete, acquire vs renew vs release)

**Role Definitions:**

| Role | Permission Count | Key Capabilities |
|------|-----------------|------------------|
| **External User** | 34 | Read-only: repos, sessions, jobs, metadata |
| **User** | 64 | Read/write: files, branches, commits, workspaces, jobs |
| **Manager** | 104 | User + create namespaces + manage members + approve requests |
| **Auditor** | 44 | Universal read (bypass ACLs) + audit/lineage access |
| **Admin** | 39 | System management + user management (NO data/audit access) |

**Separation of Duties:**
- Admin manages system but CANNOT access data, repos, audit logs, lineage
- Auditor reads everything (bypass repo ACLs) but CANNOT write or manage
- Manager approves requests up to Manager level (cannot grant more than they have)

**Permission Catalog:** See `docs/specs/authorization-system.md` for complete 137 permission list across 22 categories.

#### Repository Roles

- **Repository roles**: read < triage < write < maintain < admin (5 predefined roles).
- **Merge requires write**: Minimum role for merge is `write` (not `maintain`).
- **Self-merge forbidden**: Merge blocked when signer === commit author. Enforced in repositories module (05), not authorization.

#### Namespace Roles

- **Namespace roles**: owner, member (2 base roles) + custom roles.
- **Custom roles**: Additive composition, highest role wins. Fine-grained permissions are union of all held roles.

### Access Request & Approval Workflow

- **Request-based access**: Users without access submit role or permission requests
- **No-access UI**: Users with no role see ONLY "Request Access" screen (no navigation)
- **Role or custom**: Requests can target a role (External/User/Manager) OR custom permission set
- **One pending request**: Only one pending request per user at a time (prevent spam)
- **Manager approval authority**: Managers approve up to Manager level (External, User, Manager)
- **Admin approval authority**: Admins approve all roles (including Auditor, Admin)
- **Permission validation**: Reviewers can only approve permissions they themselves have
- **Modification before approval**: Reviewers can modify requested role/permissions before granting
- **Direct grant**: Admins/Managers can grant roles/permissions directly (bypass request)
- **Approval reason**: Optional but encouraged for compliance
- **Additional permissions**: Existing users can request role upgrades or additional permissions from profile

**Request Flow:**
1. User submits request (role or permissions + justification)
2. Request stored in `access_requests` table with status='pending'
3. Manager/Admin sees request in Settings → Access Requests
4. Reviewer validates: has authority for role? has all requested permissions?
5. Reviewer can modify requested grants before approval
6. Approve: grants recorded in `principal_roles` and/or `principal_permissions`, audit trail created
7. Deny: reason recorded, user notified

**Authority Validation:**
```
Manager tries to approve Admin request → BLOCKED
Manager tries to approve permissions they lack → BLOCKED with error message
Manager approves Manager request → ALLOWED (same level)
Admin approves any request → ALLOWED
```

### Auditor Bypass ACL

- **`repo:bypass_acl` permission**: Auditors have special permission to bypass repository ACLs
- **Universal read**: Auditors can read all repos, workspaces, jobs, sessions regardless of collaborator status
- **Read-only**: Bypass only applies to read operations, cannot write
- **Compliance use case**: Enables inspectors/regulators to review all data for audit purposes

### Guards and Safety

- **Last-owner guard**: Row-level locking (`SELECT ... FOR UPDATE`) within transactions. Verified correct with two-instance concurrency test.
- **Only main protected**: Only main branch globally protected. Other branches unprotected (force-push allowed).
- **No transfer**: Transfer feature removed from spec (needs separate design to avoid unbinding issues).

### Audit and Compliance

- **No hard delete**: Archive only. Audit and lineage retained forever.
- **Events carry IDs**: Audit events store both entity IDs (stable) and names (human-readable snapshot).
- **Namespace-scoped audit**: Owners see only their namespace events. Cross-namespace requires instance auditors.
- **Read-only auditor role**: Time-boxed, mandatory expiry, audited use (for inspectors/regulators).
- **Access reviews**: Mandatory expiry on outside collaborators and delegated grants. Scheduled review campaigns.

### Routes and Testing

- **Path classification table**: Routes classified in `authzPathMap.ts`, pinned to oxen server version. Documented in spec appendix and `docs/authorization-routes.md`.
- **Contract test**: Enumerates routes from pinned oxen container, fails on unclassified routes.
- **Testing matrix**: Generated route × role × state tests at BFF boundary.
- **Chunked uploads**: Re-authorized at each chunk and at publish (within staleness bound).

### Training

- **Separate spec**: Training system in separate spec. Each permission/capability maps to training module.
- **Assume trained**: For now, assume all users trained. No self-attestation.

## Testing Decisions

- Black-box HTTP tests per role and action, including denied cases and unclassified routes.
- Parity test comparing path map vs. enforcement logic.
- Contract test extracting routes from pinned oxen server, failing on unknown routes.
- Two-instance concurrency test for last-owner guards.
- Leakage test per list endpoint (search, favorites, activity, counts).
- Generated route × role × credential matrix.

## Out of Scope

- Breakglass and "internal" visibility.
- Long-lived PATs and service principals (removed).
- Transfer (needs separate design).
- Training implementation (separate spec).

## Implementation Gaps (from New Grilling Session)

The following gaps were identified between the spec decisions and current implementation:

### 0. Role-Based Access Control with Request/Approval Workflow (NEW - HIGHEST PRIORITY) ⏱️ 5 weeks

**Status**: New requirement. Complete redesign of authorization system.

**Scope**:
- Implement 5 formal roles (External User, User, Manager, Auditor, Admin) with 137 granular permissions
- Database schema: `principal_roles`, `principal_role_history`, `principal_permissions`, `principal_permission_history`, `access_requests`, `permission_snapshots`
- Access request workflow: users request roles/permissions, managers/admins approve up to their authority level
- Direct grant: admins/managers grant roles/permissions without request
- Request Access UI for no-access users (full-screen, no navigation)
- Profile → Permissions tab with permission grid and "Request Additional Permissions"
- Settings → Access Requests review interface with approval/denial
- Settings → Users direct grant interface
- Authorization logic: role + custom permission merging, authority validation
- Auditor bypass ACL implementation (`repo:bypass_acl` permission)
- Admin data access restriction (admins CANNOT access repos/audit/lineage)
- Complete audit trail in PostgreSQL history tables + immudb
- Versioning of all permission changes

**Details**: See `.scratch/authorization/issues/16-role-based-access-control.md` and `docs/specs/authorization-system.md`

**Blocks**: User onboarding, team collaboration, compliance requirements

### 1. Stable Entity IDs (HIGHEST PRIORITY - BLOCKING) ⏱️ 3 weeks

**Status**: Not implemented. Greenfield work.

**Scope**:
- Add `repositories` table with UUID `id`, `namespace_id` FK, unique `(namespace_id, name)`
- Add UUID `id` column to `namespaces` table, keep unique `name`
- Migrate all authorization stores to reference IDs:
  - `repoCollaborators` → `repository_id` FK
  - `namespaceMembers` → `namespace_id` FK
  - `customRepoRoles` → `repository_id` FK
  - Favorites, workspaces, jobs → `repository_id` FK
- Audit events store both IDs and name snapshots
- Tombstone tables for deleted/renamed entities (prevent name reuse)
- Request-time lookup from path to ID on every call

**Blocks**: Rename, transfer (if re-added), proper audit trail, grant persistence

### 2. Remove PATs and Service Principals (HIGH) ⏱️ 1 week

**Status**: Code still present. Needs complete removal.

**Scope**:
- Delete `pats` table
- Remove PAT routes: `POST /auth/pats`, `GET /auth/pats`, `DELETE /auth/pats/:id`
- Remove `manage_own_tokens` instance permission
- Remove `authorizeManageOwnTokens` function
- Delete `servicePrincipals` table and routes
- Remove `decideServicePrincipalManage`, `serviceprincipal.admin` action
- Remove `PatScope` type, `isScopedCredential()`, `parsePatScopes()` functions
- Remove `scopes` field from `deviceAuthorizations` table
- Update CLI to never store long-lived tokens
- Remove PAT authentication logic from request handling
- Remove all PAT/service principal UI components

**Blocks**: Code simplification, credential model clarity

### 3. Remove Access Request Workflow (MEDIUM) ⏱️ 3 days

**Status**: Fully implemented. Needs removal.

**Scope**:
- Delete `accessRequests` table
- Remove routes: `POST /auth/access-requests`, `GET /auth/access-requests`, `POST /auth/access-requests/:id`
- Remove `submitAccessRequest`, `resolveAccessRequest`, `listAccessRequests`, `canReviewAccessRequests` functions
- Remove pending user page UI
- Remove "request access" buttons/flows
- Users with no grants see empty list (0 namespaces, 0 repos)
- Remove user stories and implementation decisions referencing access requests

**Blocks**: User flow simplification, reduced complexity

### 4. Instance Admin Data Access Restriction (MEDIUM) ⏱️ 1 week

**Status**: Instance admins currently have full bypass to data.

**Scope**:
- Add check in `setNamespaceMember`: if target is instance admin, return error
- Instance admins cannot be granted namespace Owner/Member roles
- Instance admins cannot grant themselves namespace roles (self-granting forbidden)
- Remove data access bypass from authorization checks
- Instance admins can only access: admin settings, audit logs, user management, instance configuration
- Bootstrap check: if zero non-admin users exist, block namespace creation
- Update tests to verify instance admins have no data access

**Blocks**: Separation of duties compliance, GxP requirements

### 5. Self-Merge Prevention (MEDIUM) ⏱️ 3 days

**Status**: Not implemented.

**Scope**:
- Authorization enforces `write` role for merge (already done)
- Repositories module (05) adds merge-time check: extract commit author(s), compare to merge signer
- Block merge if signer === any commit author in the merge
- Audit merge attempts (approved and denied)
- Responsibility split: authorization = role check, repositories = author comparison

**Blocks**: GxP merge review gate (4-eyes principle)

### 6. Group ID Binding (MEDIUM) ⏱️ 1 week

**Status**: Currently uses normalized group names. Needs group ID binding.

**Scope**:
- Update schema: `groupKey = "iss|group_id"` instead of normalized name
- Extract group IDs from IdP claims:
  - Azure AD: `groups` claim contains GUIDs
  - Keycloak: Group IDs in claims
- Add `group_display_names` cache table: `(group_id, issuer, display_name, last_updated)`
- Admin settings: validate IdP provides group IDs
- Display names refreshed on user login
- Fallback: if group ID unavailable, store normalized name with warning flag
- Migration (if needed): admin action to refresh group bindings from current member claims

**Blocks**: Protection against IdP group rename breaking access

### 7. Path Classification Documentation (LOW) ⏱️ 1 day

**Status**: Mostly complete. Needs finalization.

**Scope**:
- Document route classification table in spec appendix ✅
- Create `docs/authorization-routes.md` ✅ (exists as uncommitted file)
- Update ADR 0002 to reflect "deny all unclassified"
- Ensure `authzPathMap.ts` is up to date with current oxen version
- Commit documentation files

**Blocks**: Developer onboarding, route classification clarity

### 8. Training Spec (DEFERRED) ⏱️ TBD

**Status**: Deferred to separate spec.

**Scope**:
- Create new spec `03-training.md` (or similar)
- Map each instance permission to required training module
- Map each namespace capability to required training module
- Map repository roles to training requirements
- Define who can mark training complete (instance admins only, no self-attestation)
- Future: LMS integration
- For now: assume all users trained (boolean flag, all or nothing)

**Blocks**: Training-gated permissions (out of scope for v1)

### 9. Remove AUTHZ_ENFORCE Flag (TRIVIAL) ⏱️ 1 hour

**Status**: Removed. Authorization is always on.

**Scope**:
- Remove `AUTHZ_ENFORCE` environment variable
- Remove `isAuthzEnforce()` function and all calls
- Authorization always enforced (no toggle)
- Update tests to assume enforcement always on
- Remove related configuration documentation

**Blocks**: Configuration simplification

### 10. Remove AUTHZ_GROUP_BOOTSTRAP Flag (TRIVIAL) ⏱️ 1 hour

**Status**: Removed. Login does not grant access from an IdP group.

**Scope**:
- Remove `AUTHZ_GROUP_BOOTSTRAP` environment variable
- Remove group-based autoprovisioning logic
- Managers grant access directly (no automatic grants from IdP groups)
- Update bootstrap documentation

**Blocks**: Configuration simplification

## Permission Catalog

### Instance Permissions (8 total)

1. `create_namespace` - Create namespaces and become Owner
2. `view_audit` - View instance-wide audit logs
3. `manage_users` - Manage user accounts, revocations
4. `manage_instance_settings` - Configure instance settings
5. `read_only_auditor` - Time-boxed read-only access to all repos (for inspectors)
6. `manage_custom_roles` - Create/edit instance-level custom roles
7. `session_connect` - Connect to desktop sessions
8. `instance_admin` - Full instance management (cannot access data)

### Namespace Capabilities (8 total)

1. `manage_settings` - Edit namespace settings
2. `manage_members` - Add/remove namespace members
3. `manage_custom_roles` - Create/edit namespace custom roles
4. `delete_namespace` - Delete the namespace
5. `review_access_requests` - Review access requests (DEPRECATED - remove with access requests)
6. `create_repositories` - Create repositories in namespace
7. `manage_group_bindings` - Bind IdP groups to namespace roles
8. `view_namespace_audit` - View namespace audit events

### Repository Roles (5 predefined)

1. `read` - Read repository data, history, metadata
2. `triage` - Read + manage issues (if applicable)
3. `write` - Read + write data, create branches, merge (needs write for merge)
4. `maintain` - Write + manage repository settings, collaborators
5. `admin` - Maintain + delete repository, manage custom roles

**Role hierarchy**: none < read < triage < write < maintain < admin

### Fine-Grained Repository Permissions (16 total)

1. `job.submit` - Submit batch jobs
2. `job.cancel` - Cancel own jobs
3. `job.manage` - Manage all jobs in repository
4. `workspace.create` - Create workspaces
5. `workspace.delete` - Delete own workspaces
6. `workspace.manage` - Manage all workspaces in repository
7. `branch.create` - Create branches
8. `branch.delete` - Delete branches
9. `branch.protect` - Manage branch protection rules
10. `merge` - Merge branches (requires `write` base role)
11. `file.write` - Write files
12. `file.delete` - Delete files
13. `metadata.edit` - Edit repository metadata
14. `collaborators.manage` - Manage repository collaborators
15. `settings.edit` - Edit repository settings
16. `custom_roles.manage` - Manage repository custom roles

## Permission Composition Rules

### Base Role Resolution

User's effective repository role is the **maximum** of:
1. Namespace Owner → `admin`
2. Namespace Member → `namespace.basePermission` (e.g., `read`)
3. Custom namespace role → `customRole.baseRepositoryRole` (e.g., `write`)
4. Direct repository collaborator → assigned role (e.g., `maintain`)
5. Group repository collaborator → highest group-assigned role (e.g., `write`)

**Hierarchy**: none < read < triage < write < maintain < admin

### Fine-Grained Permissions

- Custom roles have a base role + `permissions[]` array
- User gets **union** of all permissions from all held custom roles
- Permissions are additive only (cannot reduce inherited base)
- To restrict below namespace base: revoke membership, add as direct collaborator with lower role

### Instance Admin Bypass

- Instance admins checked **separately** from role resolution
- **No implicit data access** (separation of duties)
- Instance admins cannot be namespace members
- No bypass flag for data access

## Route Classification Table

See `docs/authorization-routes.md` for complete route classification table.

### Summary

- **Public routes**: `/api/version`, `/api/health`, `/api/oxen_version` (no auth required)
- **Namespace routes**: Require namespace membership or `create_namespace` permission
- **Repository routes**: Require minimum repo role (read, write, maintain, admin)
- **Admin routes**: Require instance admin or specific instance permissions
- **Default**: All unclassified routes denied (404/403)

### Maintenance

Route classification table in `authzPathMap.ts` is the source of truth. When oxen server version changes:
1. Update `authzPathMap.ts` with new routes
2. Run contract test to verify all routes classified
3. Update `docs/authorization-routes.md`
4. Update this spec if major changes

## Known Conflicts and Resolutions

### From Original 28 Questions (Now Superseded by New Grilling)

The original spec had 28 grilling questions (Q1-Q28). These have been superseded by the new grilling session (44 questions across 6 rounds). Major changes:

**Changed Decisions:**
- **Access requests**: Originally kept, now removed
- **Pending users**: Originally shown pending page, now see empty list
- **PATs/scoping**: Originally scoped credentials, now no PATs and no scoping
- **Instance admin**: Originally allowed elevation, now completely forbidden from data
- **Transfer**: Originally documented, now removed from spec
- **Merge role**: Originally maintain, now write minimum
- **AUTHZ_ENFORCE**: Originally toggle, now always on
- **Group bootstrap**: Originally supported, now removed

**Preserved Decisions:**
- Self-merge forbidden (Q1)
- Last-owner guards with row locking (Q7)
- Unclassified routes denied (Q2)
- Stable entity IDs (Q4, Q5)
- Group ID binding (Q13)
- Read-only auditor role (Q16)
- Only main protected (Q17)
- No hard delete (Q24)
- Training deferred (Q25)

### Cross-Spec Conflicts

- **01 (Authentication) vs 02 (Authorization)**: Group staleness resolved by authentication spec U3 (groups checked at login + refresh + privileged ops; session-cached groups bounded by 8h session lifetime).
- **02 vs 05 (Repositories)**: Self-merge prevention responsibility split - authorization enforces write role, repositories compares author to signer.
- **02 vs 04 (GxP Compliance)**: Merge signing needs write role minimum; self-merge blocked; every GxP repo needs ≥2 eligible mergers.

## Impact on Other Specs

### Blocks or Dependencies

- **Blocks 04 (GxP Compliance)**: Merge signer must differ from author (Q1); every GxP repository needs ≥2 eligible mergers.
- **Blocks 05 (Repositories)**: Stable repository IDs foundational; self-merge check lives in repositories module.
- **Blocks 09 (Jobs)**: Service principal removal means Jobs use BFF-internal tokens.
- **Depends on 01 (Authentication)**: Group staleness, credential types, revocation timing.
- **Depends on 05 (Repositories)**: Stable repository IDs must exist before authorization can reference them.

### Cross-Cutting Impacts

- **01 (Authentication)**: Group re-checking frequency aligned (login, refresh, privileged ops).
- **03 (Audit)**: Audit events store both IDs and names; namespace-scoped audit filtering.
- **05 (Repositories)**: Repository stable IDs foundational; rename as metadata-only keeps grants intact.
- **07 (CLI)**: Device flow only; no PATs; no scoping.
- **08 (Workspaces)**: Authorization re-check on lease renewal.
- **09 (Jobs)**: No service principals; BFF-internal tokens tied to submitting user.
- **12 (Metadata/Search)**: Search filtering must never leak unauthorized repository visibility.
- **13 (Favorites)**: Server-side filtering ensures favorites show only accessible repositories.
- **15 (Administration)**: Instance admin restrictions, auditor role, namespace deletion rules.

---

# Route Classification Appendix

## Public Routes (No Authentication)

| Pattern | Methods | Description |
|---------|---------|-------------|
| `/api/version` | GET, HEAD | Service version |
| `/api/health` | GET, HEAD | Health check |
| `/api/oxen_version` | GET, HEAD | Oxen server version |

## Namespace Routes

| Pattern | Methods | Min Permission | Description |
|---------|---------|----------------|-------------|
| `GET /api/namespaces` | GET | Authenticated | List visible namespaces |
| `GET /api/namespaces/:ns` | GET | Member | Namespace details |
| `POST /api/namespaces` | POST | `create_namespace` | Create namespace |

## Repository Routes

| Pattern | Methods | Min Role | Description |
|---------|---------|----------|-------------|
| `GET /api/repos/:ns` | GET | Member | List repos in namespace |
| `POST /api/repos` | POST | Member + create_repositories | Create repository |
| `GET /api/repos/:ns/:repo/**` | GET, HEAD | read | Read repository |
| `PUT /api/repos/:ns/:repo/file/**` | PUT | write | Write file |
| `DELETE /api/repos/:ns/:repo/file/**` | DELETE | write | Delete file |
| `POST /api/repos/:ns/:repo/branches` | POST | write | Create branch |
| `DELETE /api/repos/:ns/:repo/branches/:branch` | DELETE | maintain | Delete branch |
| `POST /api/repos/:ns/:repo/merge` | POST | write | Merge branches |
| `PATCH /api/repos/:ns/:repo` | PATCH | admin | Update repo metadata |
| `DELETE /api/repos/:ns/:repo` | DELETE | admin | Delete repository |

## Admin Routes

| Pattern | Methods | Min Permission | Description |
|---------|---------|----------------|-------------|
| `GET /auth/audit` | GET | `view_audit` | Query audit logs |
| `POST /auth/instance/users` | POST | `manage_users` | Manage users |
| `POST /auth/instance/revoke` | POST | `manage_users` | Revoke user credentials |

**Note**: For complete route classification, see `docs/authorization-routes.md` and `auth/src/authzPathMap.ts` (source of truth).

---

**Last Updated**: Oct 27, 2026 (New grilling session - 44 questions across 6 rounds)
**Previous Version**: Oct 26, 2026 (Original 28 questions)
