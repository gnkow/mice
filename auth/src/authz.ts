import { interpretRequest } from './requestInterpretation.js'
import { customRepoRoleIdsForUser, getRepoCollaboratorRole, getRepoCollaboratorRoleFromGroups } from './authzCollaboratorStore.js'
import { hasCompletedTraining, hasInstancePermission, isAuthzEnforce, isInstanceAdmin, maybeBootstrapInstanceAdmin, maybeDevGrantAll } from './authzInstanceStore.js'
import { customNamespaceRoleIds, hasNamespaceCapability, namespacesWithCapability, resolveNamespaceRole } from './authzMembershipStore.js'
import { getNamespace } from './authzNamespaceStore.js'
import { ownedNamespaces, userCanSeeNamespace, userHasAnyGrant } from './authzVisibility.js'
import {
  maxRepoRole,
  REPO_ROLE_RANK,
  roleAtLeast,
  type BasePermission,
  type InstancePermission,
  type RepoRole,
} from './authzTypes.js'
import type { SessionUser } from './session.js'
import { isScopedCredential } from './principal.js'
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

/**
 * Prepare principal: bootstrap / dev grant / group bootstrap. Writes state, so it runs
 * once at authentication and login; authorization decisions are read-only.
 */
export function preparePrincipal(user: SessionUser): void {
  maybeBootstrapInstanceAdmin(user)
  maybeDevGrantAll(user)
  applyGroupBootstrap(user)
}

export function canSkipPendingGate(user: SessionUser): boolean {
  if (isInstanceAdmin(user)) return true
  if (hasInstancePermission(user, 'create_namespace')) return true
  return false
}

export function isPendingUser(user: SessionUser): boolean {
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
  let effective = effectiveRepoRole(user, ns, repo)
  effective = capByPatScopes(user, ns, repo, effective)
  if (roleAtLeast(effective, need)) {
    return { ok: true, effective, bypass: false }
  }
  if (
    opts?.method &&
    opts?.action &&
    !isScopedCredential(user) &&
    hasFineRepoPermission(user, ns, repo, opts.method, opts.action)
  ) {
    return { ok: true, effective, bypass: false }
  }
  // PAT scopes never get site-admin bypass
  if (isInstanceAdmin(user) && !isScopedCredential(user)) {
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

  if (!isAuthzEnforce()) return allow()

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

  const interpreted = interpretRequest(method, pathname)
  const ns = interpreted.namespace ?? input.createNamespace
  const repo = interpreted.repo ?? input.createRepo
  const action = interpreted.authzAction
  const bypass: AuthzDecision = { allow: true, status: 403, reason: 'ok', siteAdminBypass: true }

  switch (interpreted.kind) {
    case 'public':
      return allow()
    // The proxy filters the catalog to visible namespaces.
    case 'namespace.list':
      return allow()
    case 'namespace.detail': {
      const targetNs = interpreted.targetNamespace
      if (!targetNs) return deny('Invalid namespace')
      if (userCanSeeNamespace(user, targetNs)) return allow()
      if (isInstanceAdmin(user)) return bypass
      return deny('Not allowed to view that namespace')
    }
    case 'namespace.create':
      if (isInstanceAdmin(user) || hasInstancePermission(user, 'create_namespace')) {
        return allow()
      }
      return deny('Missing permission create_namespace')
    case 'repo.create': {
      if (!ns) return deny('Namespace required to create repository')
      if (hasInstancePermission(user, 'create_namespace') && !getNamespace(ns)) {
        return allow()
      }
      const settings = getNamespace(ns)
      if (!settings) {
        if (isInstanceAdmin(user)) return bypass
        return deny('Namespace not found in AuthZ; create it first')
      }
      if (hasNamespaceCapability(ns, user, 'create_repos')) return allow()
      const nsRole = resolveNamespaceRole(ns, user)
      if (nsRole === 'owner') return allow()
      if (nsRole === 'member' && settings.membersCanCreateRepos) return allow()
      if (isInstanceAdmin(user)) return bypass
      return deny('Not allowed to create repositories in this namespace')
    }
    case 'repo.list': {
      const listNs = interpreted.targetNamespace
      if (!listNs) return deny('Invalid namespace')
      if (resolveNamespaceRole(listNs, user)) return allow()
      if (isInstanceAdmin(user)) return bypass
      return deny('Not a member of this namespace')
    }
    case 'other':
    case 'repo':
      break
  }

  if (!ns || !repo) {
    return deny('Unable to authorize path (not an allowlisted unscoped route)')
  }

  const need = interpreted.minRole

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
  if (!isAuthzEnforce()) {
    return { allow: true }
  }
  if (authorizeInstanceAction(user, 'audit.view').allow) return { allow: true }
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

/**
 * Lineage read: repo `lineage_read` (implied by read), ns `view_lineage`,
 * or instance `view_lineage` / admin for unscoped.
 */
export function authorizeLineageQuery(
  user: SessionUser,
  namespace?: string,
  repo?: string,
): { allow: boolean; reason?: string } {
  if (!isAuthzEnforce()) {
    return { allow: true }
  }
  if (!namespace || !repo) {
    if (authorizeInstanceAction(user, 'lineage.view').allow) return { allow: true }
    return {
      allow: false,
      reason: 'namespace and repo required (or view_lineage / admin)',
    }
  }
  if (hasNamespaceCapability(namespace, user, 'view_lineage')) {
    return { allow: true }
  }
  const check = hasRepoPermission(user, namespace, repo, 'read', {
    method: 'GET',
    action: 'lineage.read',
  })
  if (check.ok) return { allow: true }
  return { allow: false, reason: 'Requires lineage_read on repository' }
}

/** Lineage rebuild: repo `lineage_rebuild` (implied by admin). */
export function authorizeLineageRebuild(
  user: SessionUser,
  namespace: string,
  repo: string,
): { allow: boolean; reason?: string } {
  if (!isAuthzEnforce()) {
    return { allow: true }
  }
  if (isInstanceAdmin(user)) return { allow: true }
  const check = hasRepoPermission(user, namespace, repo, 'admin', {
    method: 'POST',
    action: 'lineage.rebuild',
  })
  if (check.ok) return { allow: true }
  return { allow: false, reason: 'Requires lineage_rebuild on repository' }
}

export type RepoAction =
  | 'job.submit'
  | 'job.read'
  | 'job.cancel'
  | 'job.complete'
  | 'workspace.read'
  | 'workspace.write'

/**
 * Role floor, HTTP verb for fine-permission mapping and denial reason per action.
 * Custom roles may grant the fine permission below the floor (jobs, workspaces).
 */
const REPO_ACTION_POLICY: Record<
  RepoAction,
  { need: RepoRole; method: string; reason: string }
> = {
  'job.submit': { need: 'write', method: 'POST', reason: 'job.submit requires repository write or job_submit' },
  'job.read': { need: 'read', method: 'GET', reason: 'job.read requires repository read or job_read' },
  'job.cancel': { need: 'write', method: 'POST', reason: 'job.cancel requires repository write or job_cancel' },
  'job.complete': { need: 'write', method: 'POST', reason: 'job.complete requires repository write or job_complete' },
  'workspace.read': { need: 'read', method: 'GET', reason: 'Requires repository read' },
  'workspace.write': { need: 'write', method: 'POST', reason: 'Requires repository write' },
}

/** One decision for repo-scoped Mice actions (jobs, Mice Workspaces). */
export function authorizeRepoAction(
  user: SessionUser,
  namespace: string,
  repo: string,
  action: RepoAction,
): { allow: boolean; reason?: string } {
  if (!isAuthzEnforce()) return { allow: true }
  const policy = REPO_ACTION_POLICY[action]
  const check = hasRepoPermission(user, namespace, repo, policy.need, {
    method: policy.method,
    action,
  })
  return check.ok ? { allow: true } : { allow: false, reason: policy.reason }
}

export type InstanceAction =
  | 'tokens.manage'
  | 'cli.device.approve'
  | 'audit.view'
  | 'lineage.view'
  | 'store.admin'

/**
 * Instance-wide actions: allowed for an instance admin or a holder of the named
 * permission. `store.admin` has no permission and rejects scoped credentials.
 */
const INSTANCE_ACTION_POLICY: Record<
  InstanceAction,
  { permission?: InstancePermission; reason: string }
> = {
  'tokens.manage': { permission: 'manage_own_tokens', reason: 'Missing permission manage_own_tokens' },
  'cli.device.approve': { permission: 'cli_device_approve', reason: 'Missing permission cli_device_approve' },
  'audit.view': { permission: 'view_audit', reason: 'Missing permission view_audit' },
  'lineage.view': { permission: 'view_lineage', reason: 'Missing permission view_lineage' },
  'store.admin': { reason: 'Requires instance admin' },
}

export function authorizeInstanceAction(
  user: SessionUser,
  action: InstanceAction,
): { allow: boolean; reason?: string } {
  if (!isAuthzEnforce()) return { allow: true }
  const policy = INSTANCE_ACTION_POLICY[action]
  if (!policy.permission) {
    if (isInstanceAdmin(user) && !isScopedCredential(user)) return { allow: true }
    return { allow: false, reason: policy.reason }
  }
  if (isInstanceAdmin(user) || hasInstancePermission(user, policy.permission)) {
    return { allow: true }
  }
  return { allow: false, reason: policy.reason }
}

/** Own PAT mint/list/revoke when enforce is on. */
export function authorizeManageOwnTokens(user: SessionUser) {
  return authorizeInstanceAction(user, 'tokens.manage')
}

/** Approve / deny CLI device codes when enforce is on. */
export function authorizeCliDeviceApprove(user: SessionUser) {
  return authorizeInstanceAction(user, 'cli.device.approve')
}

/** Store-wide operations (capabilities, GC, checkout delete): instance admin, never PAT-scoped. */
export function authorizeStoreAdmin(user: SessionUser) {
  return authorizeInstanceAction(user, 'store.admin')
}
