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

| Pattern | Methods | Decision | Description |
|---------|---------|----------|-------------|
| `GET /api/namespaces` | GET | signed-in (catalog filtered) | List; proxy filters to namespaces the caller can see |
| `GET /api/namespaces/:ns` | GET | `userCanSeeNamespace` | Member/Owner **or** any collaborator grant under that namespace |
| `POST /api/namespaces` | POST | instance `namespace.create` / `create_namespace` | Create namespace |

### Repository List / Create Routes

| Pattern | Methods | Decision | Description |
|---------|---------|----------|-------------|
| `GET /api/repos/:ns` | GET | namespace member (any seat) | List repos in namespace |
| `POST /api/repos` | POST | namespace create gate | Owner, `create_repos` capability, or Member when `membersCanCreateRepos` (not a collaborator `write` seat) |

### Repository Data Routes

Minimum roles below are collaborator floors (`hasRepoPermission`), except lifecycle rows marked † where a Namespace Owner may act without a collaborator seat.

| Pattern | Methods | Min Role | Description |
|---------|---------|----------|-------------|
| `GET /api/repos/:ns/:repo/**` | GET, HEAD | read | Read repository contents |
| `PUT /api/repos/:ns/:repo/file/**` | PUT | write | Write file |
| `DELETE /api/repos/:ns/:repo/file/**` | DELETE | write | Delete file |
| `POST /api/repos/:ns/:repo/branches` | POST | write | Create branch |
| `PUT/PATCH /api/repos/:ns/:repo/branches/:branch` | PUT, PATCH | write | Update branch pointer |
| `DELETE /api/repos/:ns/:repo/branches/:branch` | DELETE | maintain | Delete branch |
| `POST /api/repos/:ns/:repo/merge(s)` | POST | maintain | Merge branches (`/merge` or `/merges`) |
| `POST /api/repos/:ns/:repo/workspaces` | POST | write | Create oxen workspace |
| `POST /api/repos/:ns/:repo/workspaces/:id/**` | POST, PUT | write | Oxen workspace operations |
| `DELETE /api/repos/:ns/:repo/workspaces/:id` | DELETE | write | Delete oxen workspace |
| `PATCH/PUT /api/repos/:ns/:repo` | PATCH, PUT | admin † | Update repo metadata |
| `PATCH/PUT /api/repos/:ns/:repo/rename` | PATCH, PUT | admin † | Rename repository |
| `PATCH/PUT /api/repos/:ns/:repo/transfer` | PATCH, PUT | admin † | Transfer repository namespace |
| `DELETE /api/repos/:ns/:repo` | DELETE | admin † | Delete repository |

### Push/Pull Transport Routes

| Pattern | Methods | Audit action | Authz action | Min Role | Description |
|---------|---------|--------------|--------------|----------|-------------|
| `POST/PUT /api/repos/:ns/:repo/commits/**` (not complete) | POST, PUT | `other` | `push` | write | Upload chunks |
| `POST /api/repos/:ns/:repo/commits/:id/complete` | POST | `commit.publish` | `push` | write | Publish commit |
| `QUERY /api/repos/:ns/:repo/versions` | QUERY | `other` | `versions.query` | read | Query versions |
| `POST /api/repos/:ns/:repo/versions/**` | POST | `other` | `push` | write | Version operations |

**Note**: `authzActionForPath` remaps transport paths for authorization. Intermediate uploads keep audit action `other`; only `…/complete` audits as `commit.publish`. Both authorize as `push` (write).

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
| `workspace.*` | write (prefix match via `ACTION_PREFIX_MIN_ROLE`) |

`repo.create` appears in `ACTION_MIN_ROLE` so `interpretRequest` can label `POST /api/repos`, but **authorization ignores that floor** and uses the namespace create gate instead.

**Fallback for unclassified mutating routes**: If a POST/PUT/PATCH/DELETE request doesn't match any specific pattern, `minRole` falls to `admin` (denied unless the caller holds admin / Owner lifecycle for delete/metadata).

## Authorization Flow

1. **Request arrives** → Extract method, path
2. **Classify** → `classifyPath(method, path)` returns audit action, namespace, repo
3. **Interpret** → `interpretRequest()` adds route kind, `authzAction`, minimum role
4. **Authorize** (`authorizeApiRequest`):
   - `public`: allow (before pending/training gates)
   - `namespace.list`: allow signed-in callers; catalog is filtered separately
   - `namespace.detail`: `userCanSeeNamespace`
   - `namespace.create`: instance `namespace.create`
   - `repo.create`: namespace create gate (not collaborator `write`)
   - `repo.list`: any namespace membership seat
   - `repo`: `hasRepoPermission` vs `minRole`; Owner may still perform `repo.delete` / `repo.metadata` without a collaborator seat
   - `other` / unscoped: deny (default-deny)

## Permission Composition

**Repository collaborator seats are the source of truth** for repository data
operations (`effectiveRepoRole` in `auth/src/authz.ts`). Namespace membership
does not grant file/branch/workspace access on a repository.

User's effective repository role is the **maximum** of:
1. Direct repository collaborator → assigned role (e.g., `maintain`)
2. Group repository collaborator → highest group-assigned role (e.g., `write`)

Namespace Owner / Member / custom namespace roles govern **namespace** concerns
only (settings, membership, create repositories, assign approvers). Separately,
a Namespace Owner may manage the collaborator list and repository lifecycle
(rename, transfer, delete, About) without holding a collaborator seat; that is
not an inherited repo data role.

**Role hierarchy**: `admin > maintain > write > triage > read > none`

## Approver Decision

`approver` is not a rank in the hierarchy. It is an explicit grant that only a namespace Owner assigns or removes, at namespace or repository scope, with an audit event (`approver.grant`, `approver.revoke`) and a reason. `decideIsApprover(user, ns, repo)` in `auth/src/authz.ts` allows only when the user holds that grant. `maintain`, Owner, instance admin and bootstrap grants never imply it. The signing ceremony for merges into validated branches (gxp-compliance 05) calls this decision; merge itself keeps its `maintain` floor in the path map.

| Pattern | Methods | Decision | Description |
|---------|---------|----------|-------------|
| `/auth/namespaces/:ns/approvers` | GET | namespace view | List namespace-wide approvers |
| `/auth/namespaces/:ns/approvers` | PUT, DELETE | namespace Owner | Assign or remove an approver |
| `/auth/namespaces/:ns/repos/:repo/approvers` | GET | namespace view | List repository approvers |
| `/auth/namespaces/:ns/repos/:repo/approvers` | PUT, DELETE | namespace Owner | Assign or remove an approver |

## Testing

- **Docs parity** (`auth/src/authzRoutesDocs.test.ts` + `auth/src/authzRouteDocs.ts`): Documentation tables match `ACTION_MIN_ROLE` and enforced min roles; Permission Composition matches collaborator SoT
- **Contract test** (`auth/src/authzRoutesDocs.test.ts` + `auth/src/fixtures/oxen-server-routes.pinned.json`): Every pinned oxen-server route interprets to its documented minimum role; refresh the pin when upgrading `oxen/oxen-server` in compose
- **Default-deny** (`auth/src/authzRoutesDocs.test.ts`, `auth/src/authz.test.ts`): Unclassified mutating routes require admin; unscoped unknown GETs are `other`
- **Matrix test**: Role × action × state coverage at HTTP boundary

## Maintenance

When updating this table:

1. Update `auth/src/authzPathMap.ts` (source of truth)
2. Update this documentation file
3. Update `auth/src/fixtures/oxen-server-routes.pinned.json` when oxen adds or renames routes
4. Run tests: `node --import tsx --test src/authzRoutesDocs.test.ts` (from `auth/`)
5. Update spec `.specs/02-authorization.md` appendix if major changes

## Mice-Specific Routes (Non-Oxen)

Handled by the BFF (`auth/src/workspaces/routes.ts`), not proxied to oxen-server.
Repo-scoped rows use `authorizeRepoAction` → `workspace.read` (read floor) or `workspace.write` (write floor).

| Pattern | Methods | Decision | Description |
|---------|---------|----------|-------------|
| `GET /auth/workspaces?namespace&repo` | GET | `workspace.read` | List workspaces for one repo |
| `GET /auth/workspaces` (no filter) | GET | per-row `workspace.read` | List all workspaces the caller can read |
| `GET /auth/workspaces/:id` (+ files/archive/changes) | GET | `workspace.read` | Workspace details / content |
| `POST /auth/workspaces` | POST | `workspace.write` | Create Mice workspace |
| `POST /auth/workspaces/:id/retry` | POST | `workspace.write` | Retry failed prepare |
| `DELETE /auth/workspaces/:id` | DELETE | `workspace.write` | Delete Mice workspace |
| `POST /auth/workspaces/:id/leases` | POST | read or write by mode | Acquire lease (`mode=read` → read; `mode=write` → write) |
| `POST …/leases/:id/renew\|mount` | POST | lease owner or store admin | Renew / mount |
| `DELETE …/leases/:id` | DELETE | lease owner; force = store admin | Release lease |
| `GET /auth/workspaces/capabilities` | GET | store admin | Driver/capability probe |
| `GET /auth/checkouts?namespace&repo` | GET | `workspace.read` | List checkouts for one repo |
| `GET /auth/checkouts` (no filter) | GET | store admin | List all checkouts |
| `GET /auth/checkouts/:ns/:repo/:commit` | GET | `workspace.read` | Checkout status |
| `POST /auth/checkouts` | POST | `workspace.write` | Start checkout |
| `DELETE /auth/checkouts/:ns/:repo/:commit` | DELETE | store admin | Evict checkout |
| `POST /auth/store/gc` | POST | store admin | Garbage collect store |
| `POST /auth/store/scrub` | POST | store admin | Scrub store |

## Related Files

- `auth/src/authzPathMap.ts` - Source of truth for route classification (`ACTION_MIN_ROLE`)
- `auth/src/authzRouteDocs.ts` - Markdown parity helpers for this document
- `auth/src/authentication/session/requestInterpretation.ts` - Classification logic
- `auth/src/authz.ts` - Authorization decision logic (`effectiveRepoRole`)
- `.specs/02-authorization.md` - Authorization specification
- `docs/adr/0002-bff-default-deny.md` - Default-deny ADR

## See Also

- Authentication spec: `.specs/01-authentication.md`
- Repositories spec: `.specs/05-repositories.md`
- GxP Compliance spec: `.specs/04-gxp-compliance.md`
