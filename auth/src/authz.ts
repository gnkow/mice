import { classifyPath } from './audit.js'
import {
  customNamespaceRoleIds,
  customRepoRoleIdsForUser,
  getNamespace,
  getRepoCollaboratorRole,
  getRepoCollaboratorRoleFromGroups,
  hasCompletedTraining,
  hasInstancePermission,
  hasNamespaceCapability,
  isAuthzEnforce,
  isInstanceAdmin,
  maybeBootstrapInstanceAdmin,
  maybeDevGrantAll,
  namespacesWithCapability,
  ownedNamespaces,
  resolveNamespaceRole,
  userHasAnyGrant,
} from './authzStore.js'
import {
  maxRepoRole,
  REPO_ROLE_RANK,
  roleAtLeast,
  type BasePermission,
  type RepoRole,
} from './authzTypes.js'
import type { SessionUser } from './session.js'
import type { AuditVia } from './audit.js'
import { env } from './env.js'
import { applyGroupBootstrap } from './groupBootstrap.js'
import {
  customRepoRoleCoversFine,
  finePermissionForAction,
  getCustomNamespaceRole,
  getCustomRepoRole,
} from './customRoles.js'

export type AuthzDecision = {
  allow: boolean
  status: 403 | 401
  reason: string
  /** Instance admin used site_admin_bypass for this check. */
  siteAdminBypass?: boolean
  requiredRole?: RepoRole
  effectiveRole?: BasePermission
}

function allow(): AuthzDecision {
  return { allow: true, status: 403, reason: 'ok' }
}

function deny(reason: string, extra?: Partial<AuthzDecision>): AuthzDecision {
  return { allow: false, status: 403, reason, ...extra }
}

/** Prepare principal: bootstrap / dev grant. Call on login and before AuthZ. */
export function preparePrincipal(user: SessionUser): void {
  maybeBootstrapInstanceAdmin(user)
  maybeDevGrantAll(user)
  applyGroupBootstrap(user)
}

export function canSkipPendingGate(user: SessionUser): boolean {
  preparePrincipal(user)
  if (isInstanceAdmin(user)) return true
  if (hasInstancePermission(user, 'create_namespace')) return true
  return false
}

export function isPendingUser(user: SessionUser): boolean {
  preparePrincipal(user)
  if (!isAuthzEnforce()) return false
  if (canSkipPendingGate(user)) return false
  return !userHasAnyGrant(user)
}

/**
 * Additive effective repo role for user on ns/repo.
 * Owner ⇒ admin; base perms for members; user + IdP group collaborators; max of all.
 * Instance admin is handled separately (site_admin_bypass).
 */
export function effectiveRepoRole(
  user: SessionUser,
  ns: string,
  repo: string,
): BasePermission {
  preparePrincipal(user)

  let role: BasePermission = 'none'
  const nsRole = resolveNamespaceRole(ns, user)
  if (nsRole === 'owner') role = maxRepoRole(role, 'admin')
  if (nsRole === 'member') {
    const settings = getNamespace(ns)
    const base = settings?.basePermission ?? 'none'
    role = maxRepoRole(role, base)
  }
  for (const id of customNamespaceRoleIds(ns, user)) {
    const custom = getCustomNamespaceRole(ns, id)
    if (custom?.baseRepositoryRole) {
      role = maxRepoRole(role, custom.baseRepositoryRole)
    }
  }
  const direct = getRepoCollaboratorRole(ns, repo, user)
  if (direct) role = maxRepoRole(role, direct)
  const groupCollab = getRepoCollaboratorRoleFromGroups(
    ns,
    repo,
    user.groups ?? [],
  )
  if (groupCollab) role = maxRepoRole(role, groupCollab)
  return role
}

function hasFineRepoPermission(
  user: SessionUser,
  ns: string,
  repo: string,
  method: string,
  action: string,
): boolean {
  const fine = finePermissionForAction(method, action)
  if (!fine) return false
  for (const id of customRepoRoleIdsForUser(ns, repo, user)) {
    const role = getCustomRepoRole(ns, id)
    if (role && customRepoRoleCoversFine(role, fine)) return true
  }
  return false
}

function capByPatScopes(
  user: SessionUser,
  ns: string,
  repo: string,
  role: BasePermission,
): BasePermission {
  const scopes = user.patScopes
  if (!scopes?.length) return role
  let max: BasePermission = 'none'
  for (const s of scopes) {
    if (s.namespace !== ns) continue
    if (s.repo && s.repo !== repo) continue
    max = maxRepoRole(max, s.maxRole)
  }
  return REPO_ROLE_RANK[role] <= REPO_ROLE_RANK[max] ? role : max
}

export function hasRepoPermission(
  user: SessionUser,
  ns: string,
  repo: string,
  need: RepoRole,
  opts?: { method?: string; action?: string },
): { ok: boolean; effective: BasePermission; bypass: boolean } {
  preparePrincipal(user)
  let effective = effectiveRepoRole(user, ns, repo)
  effective = capByPatScopes(user, ns, repo, effective)
  if (roleAtLeast(effective, need)) {
    return { ok: true, effective, bypass: false }
  }
  if (
    opts?.method &&
    opts?.action &&
    !user.patScopes?.length &&
    hasFineRepoPermission(user, ns, repo, opts.method, opts.action)
  ) {
    return { ok: true, effective, bypass: false }
  }
  // PAT scopes never get site-admin bypass
  if (isInstanceAdmin(user) && !user.patScopes?.length) {
    return { ok: true, effective: 'admin', bypass: true }
  }
  return {
    ok: false,
    effective,
    bypass: false,
  }
}

/** Repo Admin, Owner, manage_collaborators fine grant, or instance admin. */
export function canManageRepoCollaborators(
  user: SessionUser,
  ns: string,
  repo: string,
): boolean {
  preparePrincipal(user)
  if (isInstanceAdmin(user)) return true
  if (resolveNamespaceRole(ns, user) === 'owner') return true
  const check = hasRepoPermission(user, ns, repo, 'admin')
  if (check.ok && !check.bypass) return true
  for (const id of customRepoRoleIdsForUser(ns, repo, user)) {
    const role = getCustomRepoRole(ns, id)
    if (role && customRepoRoleCoversFine(role, 'manage_collaborators')) {
      return true
    }
  }
  if (check.bypass) return true
  return false
}

/** Minimum repo role for an oxen API call. */
export function requiredRepoRoleForRequest(
  method: string,
  pathname: string,
  action: string,
): RepoRole | null {
  const m = method.toUpperCase()
  if (m === 'GET' || m === 'HEAD') return 'read'

  if (action === 'repo.delete') return 'admin'
  if (action === 'merge') return 'maintain'
  if (action === 'branch.delete') return 'maintain'
  if (
    action === 'file.write' ||
    action === 'branch.create' ||
    action === 'branch.update' ||
    action.startsWith('workspace') ||
    action === 'repo.create'
  ) {
    return 'write'
  }
  // Unknown mutating route: require admin (fail closed-ish)
  if (m !== 'GET' && m !== 'HEAD') return 'admin'
  return 'read'
}

function isPublicApiPath(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, '') || '/'
  return p === '/api/version' || p === '/api/health' || p === '/api/oxen_version'
}

export type AuthorizeInput = {
  user: SessionUser
  via: AuditVia
  method: string
  pathname: string
  /** For POST /api/repos */
  createNamespace?: string
  createRepo?: string
}

/**
 * Authorize a proxied oxen API request. When AuthZ is not enforcing, always allow.
 */
export function authorizeApiRequest(input: AuthorizeInput): AuthzDecision {
  const { user, via, method, pathname } = input
  preparePrincipal(user)

  if (!isAuthzEnforce()) return allow()

  // Breakglass: full access (operational escape hatch)
  if (via === 'breakglass') return allow()

  if (isPendingUser(user)) {
    return deny('Access pending: no namespace membership or grants')
  }

  if (
    env.authzRequireTraining &&
    !isInstanceAdmin(user) &&
    !hasCompletedTraining(user)
  ) {
    return deny('Training / GxP onboarding required')
  }

  if (isPublicApiPath(pathname)) return allow()

  const classified = classifyPath(method, pathname)
  let ns = classified.namespace ?? input.createNamespace
  let repo = classified.repo ?? input.createRepo
  const action = classified.action

  // List / read namespace catalog — any non-pending user
  if (
    (pathname === '/api/namespaces' || pathname.startsWith('/api/namespaces/')) &&
    (method === 'GET' || method === 'HEAD')
  ) {
    return allow()
  }

  // Create namespace via oxen (rare) — instance permission
  if (action === 'namespace.create') {
    if (
      isInstanceAdmin(user) ||
      hasInstancePermission(user, 'create_namespace')
    ) {
      return allow()
    }
    return deny('Missing permission create_namespace')
  }

  // Create repository
  if (action === 'repo.create' || (pathname === '/api/repos' && method === 'POST')) {
    if (!ns) return deny('Namespace required to create repository')
    if (hasInstancePermission(user, 'create_namespace') && !getNamespace(ns)) {
      return allow()
    }
    const settings = getNamespace(ns)
    if (!settings) {
      if (isInstanceAdmin(user)) {
        return { allow: true, status: 403, reason: 'ok', siteAdminBypass: true }
      }
      return deny('Namespace not found in AuthZ; create it first')
    }
    if (hasNamespaceCapability(ns, user, 'create_repos')) return allow()
    const nsRole = resolveNamespaceRole(ns, user)
    if (nsRole === 'owner') return allow()
    if (nsRole === 'member' && settings.membersCanCreateRepos) return allow()
    if (isInstanceAdmin(user)) {
      return { allow: true, status: 403, reason: 'ok', siteAdminBypass: true }
    }
    return deny('Not allowed to create repositories in this namespace')
  }

  // List repos in namespace
  if (
    /^\/api\/repos\/[^/]+$/.test(pathname.replace(/\/+$/, '')) &&
    (method === 'GET' || method === 'HEAD')
  ) {
    const parts = pathname.split('/').filter(Boolean)
    ns = decodeURIComponent(parts[2] ?? '')
    if (!ns) return deny('Invalid namespace')
    if (resolveNamespaceRole(ns, user)) return allow()
    if (isInstanceAdmin(user)) {
      return { allow: true, status: 403, reason: 'ok', siteAdminBypass: true }
    }
    return deny('Not a member of this namespace')
  }

  if (!ns || !repo) {
    // Unscoped / unrecognized — allow non-pending reads only
    if (method === 'GET' || method === 'HEAD') return allow()
    return deny('Unable to authorize path (missing namespace/repo)')
  }

  const need = requiredRepoRoleForRequest(method, pathname, action)
  if (!need) return allow()

  const check = hasRepoPermission(user, ns, repo, need, { method, action })
  if (check.ok) {
    return {
      allow: true,
      status: 403,
      reason: 'ok',
      siteAdminBypass: check.bypass,
      requiredRole: need,
      effectiveRole: check.effective,
    }
  }
  return deny(`Requires repo role ${need}`, {
    requiredRole: need,
    effectiveRole: check.effective,
  })
}

export function authorizeAuditQuery(
  user: SessionUser,
  requestedNamespace?: string,
): {
  allow: boolean
  forceNamespace?: string
  ownedOnly?: string[]
  reason?: string
} {
  preparePrincipal(user)
  if (!isAuthzEnforce()) {
    return { allow: true }
  }
  if (isInstanceAdmin(user) || hasInstancePermission(user, 'view_audit')) {
    return { allow: true }
  }
  const scoped = [
    ...new Set([
      ...ownedNamespaces(user),
      ...namespacesWithCapability(user, 'view_audit'),
    ]),
  ]
  if (scoped.length === 0) {
    return { allow: false, reason: 'Missing permission view_audit' }
  }
  if (requestedNamespace) {
    if (!scoped.includes(requestedNamespace)) {
      return { allow: false, reason: 'Not allowed to audit that namespace' }
    }
    return { allow: true, forceNamespace: requestedNamespace }
  }
  if (scoped.length === 1) {
    return { allow: true, forceNamespace: scoped[0] }
  }
  return {
    allow: true,
    ownedOnly: scoped,
  }
}
