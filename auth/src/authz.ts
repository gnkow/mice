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
  type NamespaceCapability,
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

/** The one shape every authorization decision resolves to; routes only translate it to HTTP. */
export interface Decision {
  allow: boolean
  status: number
  reason: string
}

const ALLOWED: Decision = Object.freeze({ allow: true, status: 200, reason: 'ok' })

function denied(reason: string, status = 403): Decision {
  return { allow: false, status, reason }
}

/** The scoped-credential rule: a scoped credential (PAT scopes, service principal) never gets instance-admin power. */
export function isUnscopedInstanceAdmin(user: SessionUser): boolean {
  return !isScopedCredential(user) && isInstanceAdmin(user)
}

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
  return decideInstanceAction(user, 'namespace.create').allow
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
  if (isUnscopedInstanceAdmin(user)) {
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
  return decideManageRepoCollaborators(user, ns, repo).allow
}

export function decideManageRepoCollaborators(
  user: SessionUser,
  ns: string,
  repo: string,
): Decision {
  return manageRepoCollaborators(user, ns, repo) ? ALLOWED : denied('Forbidden')
}

function manageRepoCollaborators(
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
    case 'namespace.create': {
      const d = decideInstanceAction(user, 'namespace.create')
      return d.allow ? allow() : deny(d.reason)
    }
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
  | 'instance.admin'
  | 'serviceprincipal.admin'
  | 'directory.sync'
  | 'namespace.create'
  | 'access.review.all'
  | 'session.admin'
  | 'session.create'
  | 'session.connect'

type InstancePolicy = {
  /** Any one of these instance permissions allows the action (besides admin). */
  permissions?: InstancePermission[]
  /** 'unscoped': scoped credentials never pass as admin. */
  admin: 'any' | 'unscoped'
  /** When false the action is decided even while AuthZ enforcement is off. */
  enforced: boolean
  reason: string
}

/**
 * Instance-wide actions: allowed for an instance admin or a holder of a named
 * permission. Each action records its denial reason and whether enforce-off allows it.
 */
const INSTANCE_ACTION_POLICY: Record<InstanceAction, InstancePolicy> = {
  'tokens.manage': { permissions: ['manage_own_tokens'], admin: 'any', enforced: true, reason: 'Missing permission manage_own_tokens' },
  'cli.device.approve': { permissions: ['cli_device_approve'], admin: 'any', enforced: true, reason: 'Missing permission cli_device_approve' },
  'audit.view': { permissions: ['view_audit'], admin: 'any', enforced: true, reason: 'Missing permission view_audit' },
  'lineage.view': { permissions: ['view_lineage'], admin: 'any', enforced: true, reason: 'Missing permission view_lineage' },
  'store.admin': { admin: 'unscoped', enforced: true, reason: 'Requires instance admin' },
  'instance.admin': { admin: 'any', enforced: false, reason: 'Forbidden' },
  'serviceprincipal.admin': { admin: 'any', enforced: false, reason: 'Instance admin required' },
  'directory.sync': { admin: 'any', enforced: false, reason: 'Instance admin required' },
  'namespace.create': { permissions: ['create_namespace'], admin: 'any', enforced: false, reason: 'Missing permission create_namespace' },
  'access.review.all': { permissions: ['create_namespace'], admin: 'any', enforced: false, reason: 'Forbidden' },
  'session.admin': { permissions: ['session_admin'], admin: 'any', enforced: false, reason: 'Missing permission session_admin' },
  'session.create': { permissions: ['session_admin', 'session_create'], admin: 'any', enforced: true, reason: 'Missing permission session_create' },
  'session.connect': { permissions: ['session_connect'], admin: 'any', enforced: true, reason: 'Missing permission session_connect' },
}

export function decideInstanceAction(user: SessionUser, action: InstanceAction): Decision {
  const policy = INSTANCE_ACTION_POLICY[action]
  if (policy.enforced && !isAuthzEnforce()) return ALLOWED
  const admin = policy.admin === 'unscoped' ? isUnscopedInstanceAdmin(user) : isInstanceAdmin(user)
  if (admin) return ALLOWED
  if (policy.permissions?.some((p) => hasInstancePermission(user, p))) return ALLOWED
  return denied(policy.reason)
}

export function authorizeInstanceAction(
  user: SessionUser,
  action: InstanceAction,
): { allow: boolean; reason?: string } {
  const d = decideInstanceAction(user, action)
  return d.allow ? { allow: true } : { allow: false, reason: d.reason }
}

export type NamespaceAction =
  | 'namespace.view'
  | 'namespace.settings'
  | 'namespace.settings.metadata'
  | 'namespace.delete'
  | 'namespace.members.manage'
  | 'namespace.roles.manage'
  | 'namespace.access.review'

type NamespacePolicy = {
  /** Allowed with this namespace capability (instance admin and Owner hold all). */
  capability?: NamespaceCapability
  /** Allowed to any namespace member (or instance admin). */
  member?: true
  unscopedOnly?: true
  reason: string
}

const NAMESPACE_ACTION_POLICY: Record<NamespaceAction, NamespacePolicy> = {
  'namespace.view': { member: true, reason: 'Forbidden' },
  'namespace.settings': { capability: 'manage_settings', reason: 'Forbidden' },
  'namespace.settings.metadata': { capability: 'manage_settings', unscopedOnly: true, reason: 'Forbidden' },
  'namespace.delete': { capability: 'delete_namespace', reason: 'Forbidden' },
  'namespace.members.manage': { capability: 'manage_members', reason: 'Forbidden' },
  'namespace.roles.manage': { capability: 'manage_custom_roles', reason: 'Forbidden' },
  'namespace.access.review': { capability: 'review_access_requests', reason: 'Not allowed to approve into that namespace' },
}

/** Namespace management decisions; not gated by the enforce flag. */
export function decideNamespaceAction(user: SessionUser, ns: string, action: NamespaceAction): Decision {
  const policy = NAMESPACE_ACTION_POLICY[action]
  if (policy.unscopedOnly && isScopedCredential(user)) return denied(policy.reason)
  if (policy.member && (isInstanceAdmin(user) || resolveNamespaceRole(ns, user))) return ALLOWED
  if (policy.capability && hasNamespaceCapability(ns, user, policy.capability)) return ALLOWED
  return denied(policy.reason)
}

/** Reviewing access requests: instance admin, create_namespace, or a review capability in some namespace. */
export function decideAccessReview(user: SessionUser): Decision {
  if (decideInstanceAction(user, 'access.review.all').allow) return ALLOWED
  if (namespacesWithCapability(user, 'review_access_requests').length > 0) return ALLOWED
  return denied('Forbidden')
}

/** Managing a service principal: instance admin or its current owner. */
export function decideServicePrincipalManage(user: SessionUser, isOwner: boolean): Decision {
  if (isOwner || decideInstanceAction(user, 'serviceprincipal.admin').allow) return ALLOWED
  return denied('Forbidden')
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
