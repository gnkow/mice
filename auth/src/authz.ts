import {
  confirmPrivilegedGroups,
  withDirectoryGroups,
} from './authentication/access/privilegedGroups.js'
import { extractMfaEvidence } from './authentication/signing/mfaEvidence.js'
import { decodeJwtPayload } from './authentication/oidc/oidcClaims.js'
import { interpretRequest, isScopedCredential, type SessionUser } from './authentication/index.js'
import { customRepoRoleIdsForUser, getRepoCollaboratorRole, getRepoCollaboratorRoleFromGroups } from './authzCollaboratorStore.js'
import { hasCompletedTraining, isInstanceAdmin } from './authzInstanceStore.js'
import { runPrincipalBootstrap } from './principalBootstrap.js'
import { customNamespaceRoleIds, hasNamespaceCapability, namespacesWithCapability, resolveNamespaceRole } from './authzMembershipStore.js'
import { getNamespace } from './authzNamespaceStore.js'
import { isApprover } from './authzApproverStore.js'
import { ownedNamespaces, userCanSeeNamespace } from './authzVisibility.js'
import { getUserRole, hasPermission, listRbacUsers } from './rbacStore.js'
import type { InstancePermission as RbacPermission } from './rbacCatalog.js'
import {
  maxRepoRole,
  REPO_ROLE_RANK,
  roleAtLeast,
  type BasePermission,
  type NamespaceCapability,
  type RepoRole,
} from './authzTypes.js'
import type { AuditVia } from './audit.js'
import { env } from './env.js'
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

/** The scoped-credential rule: a scoped credential (PAT scopes) never gets instance-admin power. */
export async function isUnscopedInstanceAdmin(user: SessionUser): Promise<boolean> {
  return !isScopedCredential(user) && await isInstanceAdmin(user)
}

export type AuthzDecision = {
  allow: boolean
  status: 403 | 401 | 503
  reason: string
  /** ACL bypass used for this check (`repo:bypass_acl`); recorded as acl_bypass_read in audit. */
  aclBypass?: boolean
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
 * Prepare principal at authenticate/login: allowlist Admin bootstrap only
 * (`AUTHZ_BOOTSTRAP_ADMINS`). IdP groups never write grants here — see
 * `principalBootstrap`. Writes state once per auth; authorization decisions are read-only.
 */
export async function preparePrincipal(user: SessionUser): Promise<void> {
  await runPrincipalBootstrap(user)
}

export async function canSkipPendingGate(user: SessionUser): Promise<boolean> {
  return (await getUserRole(user)) != null
}

export async function isPendingUser(user: SessionUser): Promise<boolean> {
  return (await getUserRole(user)) == null
}

/**
 * Additive effective repo role for user on ns/repo.
 * Owner ⇒ admin; base perms for members; user + IdP group collaborators; max of all.
 * Instance admin has no ACL bypass.
 */
export async function effectiveRepoRole(
  user: SessionUser,
  ns: string,
  repo: string,
): Promise<BasePermission> {

  let role: BasePermission = 'none'
  const nsRole = await resolveNamespaceRole(ns, user)
  if (nsRole === 'owner') role = maxRepoRole(role, 'admin')
  if (nsRole === 'member') {
    const settings = await getNamespace(ns)
    const base = settings?.basePermission ?? 'none'
    role = maxRepoRole(role, base)
  }
  for (const id of await customNamespaceRoleIds(ns, user)) {
    const custom = await getCustomNamespaceRole(ns, id)
    if (custom?.baseRepositoryRole) {
      role = maxRepoRole(role, custom.baseRepositoryRole)
    }
  }
  const direct = await getRepoCollaboratorRole(ns, repo, user)
  if (direct) role = maxRepoRole(role, direct)
  const groupCollab = await getRepoCollaboratorRoleFromGroups(
    ns,
    repo,
    user.groups ?? [],
  )
  if (groupCollab) role = maxRepoRole(role, groupCollab)
  return role
}

async function hasFineRepoPermission(
  user: SessionUser,
  ns: string,
  repo: string,
  method: string,
  action: string,
): Promise<boolean> {
  const fine = finePermissionForAction(method, action)
  if (!fine) return false
  for (const id of await customRepoRoleIdsForUser(ns, repo, user)) {
    const role = await getCustomRepoRole(ns, id)
    if (role && customRepoRoleCoversFine(role, fine)) return true
  }
  return false
}

function capByCliScopes(
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

export async function hasRepoPermission(
  user: SessionUser,
  ns: string,
  repo: string,
  need: RepoRole,
  opts?: { method?: string; action?: string },
): Promise<{ ok: boolean; effective: BasePermission; bypass: boolean }> {
  const subject = need === 'admin' ? await withDirectoryGroups(user) : user
  let effective = await effectiveRepoRole(subject, ns, repo)
  effective = capByCliScopes(user, ns, repo, effective)
  if (roleAtLeast(effective, need)) {
    return { ok: true, effective, bypass: false }
  }
  if (
    opts?.method &&
    opts?.action &&
    !isScopedCredential(user) &&
    await hasFineRepoPermission(subject, ns, repo, opts.method, opts.action)
  ) {
    return { ok: true, effective, bypass: false }
  }
  // Universal read: Auditor (or custom grant of repo:bypass_acl). Never for PATs.
  if (
    need === 'read' &&
    !isScopedCredential(user) &&
    await hasPermission(user, 'repo:bypass_acl') &&
    sessionHasMfa(user)
  ) {
    return { ok: true, effective, bypass: true }
  }
  return {
    ok: false,
    effective,
    bypass: false,
  }
}

export const AUDITOR_MFA_REASON = 'Auditor access requires MFA evidence'

/** The one rule: an Auditor-role principal must carry MFA evidence on every request. */
export async function auditorMfaRefusal(user: SessionUser): Promise<string | null> {
  return (await getUserRole(user)) === 'auditor' && !sessionHasMfa(user) ? AUDITOR_MFA_REASON : null
}

function sessionHasMfa(user: SessionUser): boolean {
  if (!user.idToken) return false
  try {
    return extractMfaEvidence(decodeJwtPayload(user.idToken)).hasMfa
  } catch {
    return false
  }
}

/** Only a namespace Owner assigns or removes approvers; instance admin does not. */
export async function decideManageApprovers(user: SessionUser, ns: string): Promise<Decision> {
  try {
    const actor = await withDirectoryGroups(user)
    return (await resolveNamespaceRole(ns, actor)) === 'owner' ? ALLOWED : denied('Forbidden')
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err && err.status === 503) {
      return denied('Directory unavailable', 503)
    }
    throw err
  }
}

/**
 * "Approver for this repository": holds an explicit approver grant on the repository or its
 * namespace. `maintain`, Owner, admin and bootstrap grants never imply it.
 */
export async function decideIsApprover(user: SessionUser, ns: string, repo: string): Promise<Decision> {
  return (await isApprover(ns, repo, user)) ? ALLOWED : denied('Approver role required')
}

/** Repo Admin, Owner, manage_collaborators fine grant, or instance admin. */
export async function canManageRepoCollaborators(
  user: SessionUser,
  ns: string,
  repo: string,
): Promise<boolean> {
  return (await decideManageRepoCollaborators(user, ns, repo)).allow
}

export async function decideManageRepoCollaborators(
  user: SessionUser,
  ns: string,
  repo: string,
): Promise<Decision> {
  try {
    return await manageRepoCollaborators(user, ns, repo) ? ALLOWED : denied('Forbidden')
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err && err.status === 503) {
      return denied('Directory unavailable', 503)
    }
    throw err
  }
}

async function manageRepoCollaborators(
  user: SessionUser,
  ns: string,
  repo: string,
): Promise<boolean> {
  if (await resolveNamespaceRole(ns, user) === 'owner') return true
  const check = await hasRepoPermission(user, ns, repo, 'admin')
  if (check.ok && !check.bypass) return true
  for (const id of await customRepoRoleIdsForUser(ns, repo, user)) {
    const role = await getCustomRepoRole(ns, id)
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

export { confirmPrivilegedGroups }

/** Authorize a proxied oxen API request. */
export async function authorizeApiRequest(input: AuthorizeInput): Promise<AuthzDecision> {
  const { user, via, method, pathname } = input
  const interpreted = interpretRequest(method, pathname)

  if (interpreted.kind === 'public') return allow()

  if (await isPendingUser(user)) {
    return deny('Access pending: no formal role')
  }

  if (
    env.authzRequireTraining &&
    !await isInstanceAdmin(user) &&
    !await hasCompletedTraining(user)
  ) {
    return deny('Training / GxP onboarding required')
  }

  const ns = interpreted.namespace ?? input.createNamespace
  const repo = interpreted.repo ?? input.createRepo
  const action = interpreted.authzAction
  let mutationUser = user
  if (
    !['GET', 'HEAD'].includes(method) &&
    (interpreted.kind === 'repo' || interpreted.kind === 'repo.create')
  ) {
    try {
      mutationUser = await withDirectoryGroups(user)
    } catch (err) {
      if (err && typeof err === 'object' && 'status' in err && err.status === 503) {
        return { allow: false, status: 503, reason: 'Directory unavailable' }
      }
      throw err
    }
  }

  switch (interpreted.kind) {
    case 'public':
      return allow()
    // The proxy filters the catalog to visible namespaces.
    case 'namespace.list':
      return allow()
    case 'namespace.detail': {
      const targetNs = interpreted.targetNamespace
      if (!targetNs) return deny('Invalid namespace')
      if (await userCanSeeNamespace(user, targetNs)) return allow()
      return deny('Not allowed to view that namespace')
    }
    case 'namespace.create': {
      const d = await decideInstanceAction(user, 'namespace.create')
      return d.allow ? allow() : deny(d.reason)
    }
    case 'repo.create': {
      if (!ns) return deny('Namespace required to create repository')
      if (await hasPermission(user, 'namespace:create') && !await getNamespace(ns)) {
        return allow()
      }
      const settings = await getNamespace(ns)
      if (!settings) {
        return deny('Namespace not found in AuthZ; create it first')
      }
      if (await hasNamespaceCapability(ns, mutationUser, 'create_repos')) return allow()
      const nsRole = await resolveNamespaceRole(ns, mutationUser)
      if (nsRole === 'owner') return allow()
      if (nsRole === 'member' && settings.membersCanCreateRepos) return allow()
      return deny('Not allowed to create repositories in this namespace')
    }
    case 'repo.list': {
      const listNs = interpreted.targetNamespace
      if (!listNs) return deny('Invalid namespace')
      if (await resolveNamespaceRole(listNs, user)) return allow()
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
  const actor = mutationUser

  const check = await hasRepoPermission(actor, ns, repo, need, { method, action })
  if (check.ok) {
    return {
      allow: true,
      status: 403,
      reason: 'ok',
      aclBypass: check.bypass,
      requiredRole: need,
      effectiveRole: check.effective,
    }
  }
  return deny(`Requires repo role ${need}`, {
    requiredRole: need,
    effectiveRole: check.effective,
  })
}

export async function authorizeAuditQuery(
  user: SessionUser,
  requestedNamespace?: string,
): Promise<{
  allow: boolean
  forceNamespace?: string
  ownedOnly?: string[]
  reason?: string
}> {
  if ((await authorizeInstanceAction(user, 'audit.view')).allow) return { allow: true }
  const scoped = [
    ...new Set([
      ...await ownedNamespaces(user),
      ...await namespacesWithCapability(user, 'view_audit'),
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
export async function authorizeLineageQuery(
  user: SessionUser,
  namespace?: string,
  repo?: string,
): Promise<{ allow: boolean; reason?: string }> {
  if (!namespace || !repo) {
    if ((await authorizeInstanceAction(user, 'lineage.view')).allow) return { allow: true }
    return {
      allow: false,
      reason: 'namespace and repo required (or view_lineage / admin)',
    }
  }
  if (await hasNamespaceCapability(namespace, user, 'view_lineage')) {
    return { allow: true }
  }
  const check = await hasRepoPermission(user, namespace, repo, 'read', {
    method: 'GET',
    action: 'lineage.read',
  })
  if (check.ok) return { allow: true }
  return { allow: false, reason: 'Requires lineage_read on repository' }
}

/** Lineage rebuild: repo `lineage_rebuild` (implied by admin). */
export async function authorizeLineageRebuild(
  user: SessionUser,
  namespace: string,
  repo: string,
): Promise<{ allow: boolean; reason?: string }> {
  const check = await hasRepoPermission(user, namespace, repo, 'admin', {
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
export async function authorizeRepoAction(
  user: SessionUser,
  namespace: string,
  repo: string,
  action: RepoAction,
): Promise<{ allow: boolean; reason?: string; status?: 403 | 503 }> {
  const policy = REPO_ACTION_POLICY[action]
  let actor = user
  if (policy.method !== 'GET') {
    try {
      actor = await withDirectoryGroups(user)
    } catch (err) {
      if (err && typeof err === 'object' && 'status' in err && err.status === 503) {
        return { allow: false, reason: 'Directory unavailable', status: 503 }
      }
      throw err
    }
  }
  const check = await hasRepoPermission(actor, namespace, repo, policy.need, {
    method: policy.method,
    action,
  })
  return check.ok
    ? { allow: true }
    : { allow: false, reason: policy.reason, status: 403 }
}

export type InstanceAction =
  | 'tokens.manage'
  | 'cli.device.approve'
  | 'audit.view'
  | 'lineage.view'
  | 'store.admin'
  | 'instance.admin'
  | 'directory.sync'
  | 'namespace.create'
  | 'access.review.all'
  | 'session.admin'
  | 'session.create'
  | 'session.connect'

type InstancePolicy = {
  /** Any one of these RBAC instance permissions allows the action. */
  permissions: readonly RbacPermission[]
  /** 'unscoped': scoped credentials (PAT) never pass, even with the permission. */
  credential: 'any' | 'unscoped'
  reason: string
}

/**
 * Instance-wide actions: allowed when the principal's effective RBAC permissions
 * include any listed permission. Boolean instance-admin no longer short-circuits.
 */
const INSTANCE_ACTION_POLICY: Record<InstanceAction, InstancePolicy> = {
  'tokens.manage': { permissions: ['tokens:create', 'tokens:list', 'tokens:revoke'], credential: 'any', reason: 'Missing permission tokens:create' },
  'cli.device.approve': { permissions: ['cli_device:approve'], credential: 'any', reason: 'Missing permission cli_device:approve' },
  'audit.view': { permissions: ['audit:read'], credential: 'any', reason: 'Missing permission audit:read' },
  'lineage.view': { permissions: ['lineage:read'], credential: 'any', reason: 'Missing permission lineage:read' },
  'store.admin': { permissions: ['store:gc', 'store:scrub'], credential: 'unscoped', reason: 'Missing permission store:gc' },
  'instance.admin': { permissions: ['instance:admins:add', 'instance:settings:update'], credential: 'any', reason: 'Missing permission instance:admins:add' },
  'directory.sync': { permissions: ['instance:settings:update'], credential: 'any', reason: 'Missing permission instance:settings:update' },
  'namespace.create': { permissions: ['namespace:create'], credential: 'any', reason: 'Missing permission namespace:create' },
  'access.review.all': { permissions: ['access_request:review'], credential: 'any', reason: 'Missing permission access_request:review' },
  'session.admin': { permissions: ['session:delete'], credential: 'any', reason: 'Missing permission session:delete' },
  'session.create': { permissions: ['session:create'], credential: 'any', reason: 'Missing permission session:create' },
  'session.connect': { permissions: ['session:connect'], credential: 'any', reason: 'Missing permission session:connect' },
}

export async function decideInstanceAction(user: SessionUser, action: InstanceAction): Promise<Decision> {
  const policy = INSTANCE_ACTION_POLICY[action]
  if (policy.credential === 'unscoped' && isScopedCredential(user)) {
    return denied(policy.reason)
  }
  const mfaRefusal = await auditorMfaRefusal(user)
  if (mfaRefusal) return denied(mfaRefusal)
  for (const p of policy.permissions) {
    if (await hasPermission(user, p)) return ALLOWED
  }
  if (action === 'namespace.create' && !(await hasNonAdminUsers())) {
    return denied('No non-admin users exist yet: grant namespace:create to a manager first')
  }
  return denied(policy.reason)
}

async function hasNonAdminUsers(): Promise<boolean> {
  return (await listRbacUsers()).some((u) => u.role !== null && u.role !== 'admin')
}

export async function authorizeInstanceAction(
  user: SessionUser,
  action: InstanceAction,
): Promise<{ allow: boolean; reason?: string }> {
  const d = await decideInstanceAction(user, action)
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

/** Namespace management decisions. */
export async function decideNamespaceAction(user: SessionUser, ns: string, action: NamespaceAction): Promise<Decision> {
  const policy = NAMESPACE_ACTION_POLICY[action]
  if (policy.unscopedOnly && isScopedCredential(user)) return denied(policy.reason)
  let actor = user
  if (action !== 'namespace.view') {
    try {
      actor = await withDirectoryGroups(user)
    } catch (err) {
      if (err && typeof err === 'object' && 'status' in err && err.status === 503) {
        return denied('Directory unavailable', 503)
      }
      throw err
    }
  }
  if (policy.member && await resolveNamespaceRole(ns, actor)) return ALLOWED
  if (policy.capability && await hasNamespaceCapability(ns, actor, policy.capability)) return ALLOWED
  return denied(policy.reason)
}

/** Reviewing access requests: instance admin, create_namespace, or a review capability in some namespace. */
export async function decideAccessReview(user: SessionUser): Promise<Decision> {
  if ((await decideInstanceAction(user, 'access.review.all')).allow) return ALLOWED
  if ((await namespacesWithCapability(user, 'review_access_requests')).length > 0) return ALLOWED
  return denied('Forbidden')
}

/** Own PAT mint/list/revoke. */
export async function authorizeManageOwnTokens(user: SessionUser) {
  return await authorizeInstanceAction(user, 'tokens.manage')
}

/** Approve / deny CLI device codes. */
export async function authorizeCliDeviceApprove(user: SessionUser) {
  return await authorizeInstanceAction(user, 'cli.device.approve')
}

/** Store-wide operations (capabilities, GC, checkout delete): instance admin, never PAT-scoped. */
export async function authorizeStoreAdmin(user: SessionUser) {
  return await authorizeInstanceAction(user, 'store.admin')
}
