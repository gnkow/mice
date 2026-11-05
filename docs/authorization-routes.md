# Authorization Route Classification

This document describes how HTTP routes are classified for authorization purposes. The source of truth is `auth/src/authzPathMap.ts`.

## Overview

Every HTTP request to the BFF is classified into:
1. **Route kind** - determines authorization flow (public, namespace, repo, etc.)
2. **Action** - audit label and authorization key
3. **Minimum role** - lowest repo role allowed to perform the action

**Default-deny**: Any route not explicitly classified is denied (returns 403/404).

## Route Classification Table

### Public Routes (No Authentication Required)

| Pattern | Methods | Description |
|---------|---------|-------------|
| `/api/version` | GET, HEAD | Service version |
| `/api/health` | GET, HEAD | Health check |
| `/api/oxen_version` | GET, HEAD | Oxen server version |

### Namespace Routes

| Pattern | Methods | Min Permission | Description |
|---------|---------|----------------|-------------|
| `GET /api/namespaces` | GET | Authenticated | List namespaces user can see |
| `GET /api/namespaces/:ns` | GET | Member | Namespace details |
| `POST /api/namespaces` | POST | `create_namespace` | Create namespace |

### Repository List Routes

| Pattern | Methods | Min Role | Description |
|---------|---------|----------|-------------|
| `GET /api/repos/:ns` | GET | Member | List repos in namespace |
| `POST /api/repos` | POST | write | Create repository |

### Repository Data Routes

| Pattern | Methods | Min Role | Description |
|---------|---------|----------|-------------|
| `GET /api/repos/:ns/:repo/**` | GET, HEAD | read | Read repository contents |
| `PUT /api/repos/:ns/:repo/file/**` | PUT | write | Write file |
| `DELETE /api/repos/:ns/:repo/file/**` | DELETE | write | Delete file |
| `POST /api/repos/:ns/:repo/branches` | POST | write | Create branch |
| `PUT /api/repos/:ns/:repo/branches/:branch` | PUT | write | Update branch pointer |
| `DELETE /api/repos/:ns/:repo/branches/:branch` | DELETE | maintain | Delete branch |
| `POST /api/repos/:ns/:repo/merge` | POST | maintain | Merge branches |
| `POST /api/repos/:ns/:repo/workspaces` | POST | write | Create workspace |
| `POST /api/repos/:ns/:repo/workspaces/:id/**` | POST, PUT | write | Workspace operations |
| `DELETE /api/repos/:ns/:repo/workspaces/:id` | DELETE | write | Delete workspace |
| `PATCH /api/repos/:ns/:repo` | PATCH | admin | Update repo metadata |
| `DELETE /api/repos/:ns/:repo` | DELETE | admin | Delete repository |

### Push/Pull Transport Routes

| Pattern | Methods | Action | Min Role | Description |
|---------|---------|--------|----------|-------------|
| `POST /api/repos/:ns/:repo/commits/**` | POST, PUT | push | write | Upload chunks |
| `POST /api/repos/:ns/:repo/commits/:id/complete` | POST | commit.publish | write | Publish commit |
| `QUERY /api/repos/:ns/:repo/versions` | QUERY | versions.query | read | Query versions |
| `POST /api/repos/:ns/:repo/versions/**` | POST | push | write | Version operations |

**Note**: Transport routes use special `authzActionForPath` mapping to classify intermediate uploads as `push` (write required) for authorization, while audit logs them with specific action names.

## Action Minimum Roles

The `ACTION_MIN_ROLE` table in `authzPathMap.ts` defines the minimum repo role per action:

| Action | Min Role |
|--------|----------|
| `repo.delete` | admin |
| `repo.metadata` | admin |
| `merge` | maintain |
| `branch.delete` | maintain |
| `file.write` | write |
| `file.delete` | write |
| `branch.create` | write |
| `branch.update` | write |
| `repo.create` | write |
| `push` | write |
| `versions.query` | read |
| `workspace.*` | write (prefix match) |

**Fallback for unclassified mutating routes**: If a POST/PUT/PATCH/DELETE request doesn't match any specific pattern, it falls to `admin` (will be denied unless classified).

## Authorization Flow

1. **Request arrives** → Extract method, path
2. **Classify** → `classifyPath(method, path)` returns action, namespace, repo
3. **Interpret** → `interpretRequest()` adds route kind, minimum role
4. **Authorize**:
   - Public routes: allow
   - Namespace routes: check namespace membership or `create_namespace` permission
   - Repo routes: resolve effective repo role, compare to minimum
   - Other: deny (default-deny)

## Permission Composition

User's effective repo role is the **maximum** of:
1. Namespace Owner → `admin`
2. Namespace Member → `namespace.basePermission` (e.g., `read`)
3. Custom namespace role → `customRole.baseRepositoryRole` (e.g., `write`)
4. Direct collaborator → assigned role (e.g., `maintain`)
5. Group collaborator → highest group-assigned role (e.g., `write`)

**Role hierarchy**: `admin > maintain > write > triage > read > none`

## Approver Decision

`approver` is not a rank in the hierarchy. It is an explicit grant that only a namespace Owner assigns or removes, at namespace or repository scope, with an audit event (`approver.grant`, `approver.revoke`) and a reason. `decideIsApprover(user, ns, repo)` in `auth/src/authz.ts` allows only when the user holds that grant. `maintain`, Owner, instance admin and bootstrap grants never imply it. The signing ceremony for merges into validated branches (gxp-compliance 01) calls this decision; merge itself keeps its `maintain` floor in the path map.

| Pattern | Methods | Decision | Description |
|---------|---------|----------|-------------|
| `/auth/namespaces/:ns/approvers` | GET | namespace view | List namespace-wide approvers |
| `/auth/namespaces/:ns/approvers` | PUT, DELETE | namespace Owner | Assign or remove an approver |
| `/auth/namespaces/:ns/repos/:repo/approvers` | GET | namespace view | List repository approvers |
| `/auth/namespaces/:ns/repos/:repo/approvers` | PUT, DELETE | namespace Owner | Assign or remove an approver |

## Testing

- **Parity test** (`auth/src/authz.test.ts`): Verifies `OXEN_PATH_ROLE_MAP` matches `ACTION_MIN_ROLE`
- **Contract test** (TODO): Extract routes from pinned oxen-server, fail on unclassified routes
- **Matrix test**: Role × action × state coverage at HTTP boundary

## Maintenance

When updating this table:

1. Update `auth/src/authzPathMap.ts` (source of truth)
2. Update this documentation file
3. Run tests: `npm test auth/src/authz.test.ts`
4. Update spec `.specs/02-authorization.md` appendix if major changes

## Mice-Specific Routes (Non-Oxen)

These routes are handled by the BFF directly (not proxied to oxen-server):

| Pattern | Methods | Min | Description |
|---------|---------|-----|-------------|
| `GET /auth/workspaces` | GET | read | List workspaces (with namespace+repo filter) |
| `GET /auth/workspaces/:id` | GET | read | Workspace details |
| `POST /auth/workspaces` | POST | write | Create workspace |
| `DELETE /auth/workspaces/:id` | DELETE | write | Delete workspace |
| `POST /auth/workspaces/:id/leases` | POST | read/write | Lease workspace (mode-dependent) |
| `GET /auth/checkouts` | GET | read | List checkouts (with filter) |
| `POST /auth/checkouts` | POST | write | Create checkout |
| `DELETE /auth/checkouts/:ns/:repo/:commit` | DELETE | instance-admin | Delete checkout (admin only) |
| `POST /auth/store/gc` | POST | instance-admin | Garbage collect store |

## Related Files

- `auth/src/authzPathMap.ts` - Source of truth for route classification
- `auth/src/authentication/session/requestInterpretation.ts` - Classification logic
- `auth/src/authz.ts` - Authorization decision logic
- `.specs/02-authorization.md` - Authorization specification
- `docs/adr/0002-bff-default-deny.md` - Default-deny ADR

## See Also

- Authentication spec: `.specs/01-authentication.md`
- Repositories spec: `.specs/05-repositories.md`
- GxP Compliance spec: `.specs/04-gxp-compliance.md`
