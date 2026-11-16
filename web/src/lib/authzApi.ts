import type { AuthUser } from './auth'
import {
  CHANGE_CONTROL_HEADER,
  REASON_CATEGORY_HEADER,
  REASON_HEADER,
  SIGNATURE_HEADER,
  summarizeMutation,
  withReason,
} from './reason'

export type BasePermission =
  | 'none'
  | 'read'
  | 'triage'
  | 'write'
  | 'maintain'
  | 'admin'

export type NamespaceRole = 'owner' | 'member'
export type RepoRole = 'read' | 'triage' | 'write' | 'maintain' | 'admin'

/** Predefined or custom namespace role id. */
export type MemberRoleRef = NamespaceRole | string
/** Predefined or custom repo role id. */
export type CollaboratorRoleRef = RepoRole | string

export type InstancePermission =
  | 'create_namespace'
  | 'view_audit'
  | 'view_lineage'
  | 'manage_own_tokens'
  | 'cli_device_approve'
  | 'session_create'
  | 'session_connect'
  | 'session_admin'

export type NamespaceCapability =
  | 'manage_members'
  | 'manage_settings'
  | 'manage_custom_roles'
  | 'create_repos'
  | 'view_audit'
  | 'view_lineage'
  | 'review_access_requests'
  | 'delete_namespace'

export type RepoFinePermission =
  | 'contents_read'
  | 'contents_write'
  | 'workspaces'
  | 'merge'
  | 'delete_branch'
  | 'manage_collaborators'
  | 'manage_repo_metadata'
  | 'repo_delete'
  | 'other_mutate'
  | 'job_submit'
  | 'job_read'
  | 'job_cancel'
  | 'job_complete'
  | 'lineage_read'
  | 'lineage_rebuild'

export type GroupBindingMode = 'id-based' | 'name-based'

export type MemberPrincipal =
  | { kind: 'user'; sub: string; iss: string; role: MemberRoleRef }
  | {
      kind: 'group'
      group: string
      role: MemberRoleRef
      name?: string
      bindingMode?: GroupBindingMode
    }

export type CollaboratorPrincipal =
  | { kind: 'user'; sub: string; iss: string; role: CollaboratorRoleRef }
  | {
      kind: 'group'
      group: string
      role: CollaboratorRoleRef
      name?: string
      bindingMode?: GroupBindingMode
    }

export type CustomNamespaceRole = {
  id: string
  name: string
  description?: string
  permissions: NamespaceCapability[]
  baseRepositoryRole?: BasePermission
}

export type CustomRepoRole = {
  id: string
  name: string
  description?: string
  base: 'read' | 'triage' | 'write' | 'maintain'
  permissions: RepoFinePermission[]
}

function normalizeMember(m: {
  kind?: string
  sub?: string
  iss?: string
  group?: string
  name?: string
  role: MemberRoleRef
  bindingMode?: GroupBindingMode
}): MemberPrincipal {
  if (m.kind === 'group' || (m.group && !m.sub)) {
    const name = m.name?.trim()
    return {
      kind: 'group',
      group: String(m.group ?? ''),
      role: m.role,
      ...(name ? { name } : {}),
      ...(m.bindingMode ? { bindingMode: m.bindingMode } : {}),
    }
  }
  return {
    kind: 'user',
    sub: String(m.sub ?? ''),
    iss: String(m.iss ?? ''),
    role: m.role,
  }
}

function normalizeCollaborator(c: {
  kind?: string
  sub?: string
  iss?: string
  group?: string
  name?: string
  role: CollaboratorRoleRef
}): CollaboratorPrincipal {
  if (c.kind === 'group' || (c.group && !c.sub)) {
    const name = c.name?.trim()
    return { kind: 'group', group: String(c.group ?? ''), role: c.role, ...(name ? { name } : {}) }
  }
  return {
    kind: 'user',
    sub: String(c.sub ?? ''),
    iss: String(c.iss ?? ''),
    role: c.role,
  }
}

export type DirectoryUserHit = {
  kind: 'user'
  sub: string
  iss: string
  email: string
  name: string
}

export type DirectoryGroupHit = {
  kind: 'group'
  group: string
  name: string
}

export type DirectoryHit = DirectoryUserHit | DirectoryGroupHit

export type DirectorySearchResult = {
  results: DirectoryHit[]
  source: 'keycloak' | 'store' | 'mixed' | 'none'
  providerConfigured: boolean
}

export function searchDirectory(
  q: string,
  kind: 'user' | 'group' = 'user',
  signal?: AbortSignal,
) {
  const params = new URLSearchParams()
  params.set('q', q)
  params.set('kind', kind)
  return authzFetch<DirectorySearchResult>(
    `/auth/directory/search?${params.toString()}`,
    { signal },
  )
}

/** Failure from an AuthZ BFF call; carries the HTTP status and machine code when the server sent one. */
export class AuthzError extends Error {
  readonly status: number
  readonly code?: string
  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = 'AuthzError'
    this.status = status
    this.code = code
  }
}

export async function authzFetch<T>(
  path: string,
  init?: RequestInit & { signal?: AbortSignal },
): Promise<T> {
  const send = (submission?: {
    reason: string
    category: string
    changeControlId?: string
    signatureId?: string
  }) =>
    fetch(path, {
      credentials: 'same-origin',
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
        ...(submission
          ? {
              [REASON_HEADER]: submission.reason,
              [REASON_CATEGORY_HEADER]: submission.category,
              [SIGNATURE_HEADER]: submission.signatureId!,
              ...(submission.changeControlId
                ? { [CHANGE_CONTROL_HEADER]: submission.changeControlId }
                : {}),
            }
          : {}),
      },
    })
  const method = (init?.method ?? 'GET').toUpperCase()
  const mutationBody =
    typeof init?.body === 'string'
      ? (() => {
          try {
            return JSON.parse(init.body) as unknown
          } catch {
            return undefined
          }
        })()
      : undefined
  const res =
    method === 'GET' || method === 'HEAD'
      ? await send()
      : await withReason(send, {
          changeSummary: summarizeMutation(method, path),
          method,
          path,
          body: mutationBody,
          init,
        })
  const text = await res.text()
  let body: unknown = {}
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = { raw: text }
    }
  }
  if (!res.ok) {
    const err = body as { error?: string; code?: string }
    throw new AuthzError(err.error || `AuthZ ${res.status}`, res.status, err.code)
  }
  return body as T
}

export async function fetchNamespaceAuthz(ns: string, signal?: AbortSignal) {
  const data = await authzFetch<{
    id: string
    name: string
    description: string
    basePermission: BasePermission
    membersCanCreateRepos: boolean
    members: Array<
      MemberPrincipal | { sub: string; iss: string; role: MemberRoleRef }
    >
    unresolvedGroups?: string[]
    groupBindingWarning?: string
  }>(`/auth/namespaces/${encodeURIComponent(ns)}`, { signal })
  return {
    ...data,
    members: data.members.map(normalizeMember),
    unresolvedGroups: data.unresolvedGroups ?? [],
    groupBindingWarning: data.groupBindingWarning,
  }
}

export type NamespaceSettingsVersion = {
  validFrom: string
  validTo: string | null
  name: string
  description: string
  basePermission: BasePermission
  membersCanCreateRepos: boolean
}

export function fetchNamespaceSettingsHistory(ns: string, signal?: AbortSignal) {
  return authzFetch<{ versions: NamespaceSettingsVersion[] }>(
    `/auth/namespaces/${encodeURIComponent(ns)}/settings/history`,
    { signal },
  )
}

export type GroupBindingStatus = {
  mode: GroupBindingMode
  message: string
  warning: boolean
  checkedAt: string | null
}

export function fetchGroupBindingStatus(signal?: AbortSignal) {
  return authzFetch<GroupBindingStatus>('/auth/instance/group-binding', { signal })
}

export function checkGroupBindingMode(sampleGroups?: string[]) {
  return authzFetch<GroupBindingStatus>('/auth/instance/group-binding/check', {
    method: 'POST',
    body: JSON.stringify(sampleGroups ? { sampleGroups } : {}),
  })
}

export function patchNamespaceAuthz(
  ns: string,
  patch: Partial<{
    name: string
    description: string
    basePermission: BasePermission
    membersCanCreateRepos: boolean
  }>,
) {
  return authzFetch<{
    ok: boolean
    id?: string
    name?: string
    namespace: {
      id: string
      name: string
      description: string
      basePermission: BasePermission
      membersCanCreateRepos: boolean
    } | null
  }>(`/auth/namespaces/${encodeURIComponent(ns)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

export function putNamespaceMember(
  ns: string,
  member:
    | { kind?: 'user'; sub: string; iss: string; role: MemberRoleRef }
    | { kind: 'group'; group: string; name?: string; role: MemberRoleRef },
) {
  return authzFetch(`/auth/namespaces/${encodeURIComponent(ns)}/members`, {
    method: 'PUT',
    body: JSON.stringify(
      member.kind === 'group'
        ? {
            kind: 'group',
            group: member.group,
            role: member.role,
            ...(member.name ? { name: member.name } : {}),
          }
        : {
            kind: 'user',
            sub: member.sub,
            iss: member.iss,
            role: member.role,
          },
    ),
  })
}

export function deleteNamespaceMember(
  ns: string,
  member:
    | { kind?: 'user'; sub: string; iss: string }
    | { kind: 'group'; group: string },
) {
  return authzFetch(`/auth/namespaces/${encodeURIComponent(ns)}/members`, {
    method: 'DELETE',
    body: JSON.stringify(
      member.kind === 'group'
        ? { kind: 'group', group: member.group }
        : {
            kind: 'user',
            sub: (member as { sub: string }).sub,
            iss: (member as { iss: string }).iss,
          },
    ),
  })
}

export function createNamespaceAuthz(input: {
  name: string
  basePermission: BasePermission
  membersCanCreateRepos?: boolean
}) {
  return authzFetch<{
    ok: boolean
    name: string
    namespace: {
      basePermission: BasePermission
      membersCanCreateRepos: boolean
      createdAt: string
    } | null
  }>('/auth/namespaces', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export type AuthzNamespaceSummary = {
  id: string
  name: string
  description: string
  basePermission: BasePermission
  membersCanCreateRepos: boolean
  createdAt: string
  memberCount: number
  role: NamespaceRole | null
}

export function listAuthzNamespaces(signal?: AbortSignal) {
  return authzFetch<{ namespaces: AuthzNamespaceSummary[] }>(
    '/auth/namespaces',
    { signal },
  )
}

export function deleteNamespaceAuthz(
  ns: string,
  opts?: { deleteRepositories?: boolean },
) {
  return authzFetch<{ ok: boolean; deletedRepositories: string[] }>(
    `/auth/namespaces/${encodeURIComponent(ns)}`,
    {
      method: 'DELETE',
      body: JSON.stringify({
        deleteRepositories: opts?.deleteRepositories !== false,
      }),
    },
  )
}

export async function fetchRepoCollaborators(
  ns: string,
  repo: string,
  signal?: AbortSignal,
) {
  const data = await authzFetch<{
    collaborators: Array<
      | CollaboratorPrincipal
      | { sub: string; iss: string; role: CollaboratorRoleRef }
    >
  }>(
    `/auth/namespaces/${encodeURIComponent(ns)}/repos/${encodeURIComponent(repo)}/collaborators`,
    { signal },
  )
  return {
    collaborators: data.collaborators.map(normalizeCollaborator),
  }
}

export function putRepoCollaborator(
  ns: string,
  repo: string,
  collab:
    | { kind?: 'user'; sub: string; iss: string; role: CollaboratorRoleRef }
    | { kind: 'group'; group: string; name?: string; role: CollaboratorRoleRef },
) {
  return authzFetch(
    `/auth/namespaces/${encodeURIComponent(ns)}/repos/${encodeURIComponent(repo)}/collaborators`,
    {
      method: 'PUT',
      body: JSON.stringify(
        collab.kind === 'group'
          ? {
              kind: 'group',
              group: collab.group,
              role: collab.role,
              ...(collab.name ? { name: collab.name } : {}),
            }
          : {
              kind: 'user',
              sub: (collab as { sub: string }).sub,
              iss: (collab as { iss: string }).iss,
              role: collab.role,
            },
      ),
    },
  )
}

export function deleteRepoCollaborator(
  ns: string,
  repo: string,
  collab:
    | { kind?: 'user'; sub: string; iss: string }
    | { kind: 'group'; group: string },
) {
  return authzFetch(
    `/auth/namespaces/${encodeURIComponent(ns)}/repos/${encodeURIComponent(repo)}/collaborators`,
    {
      method: 'DELETE',
      body: JSON.stringify(
        collab.kind === 'group'
          ? { kind: 'group', group: collab.group }
          : {
              kind: 'user',
              sub: (collab as { sub: string }).sub,
              iss: (collab as { iss: string }).iss,
            },
      ),
    },
  )
}

export function submitAccessRequest(input: {
  message: string
  requestedRole?: string | null
  requestedPermissions?: string[]
}) {
  return authzFetch<{ ok: true; request: AccessRequestRow }>('/auth/access-requests', {
    method: 'POST',
    body: JSON.stringify({
      message: input.message,
      ...(input.requestedRole !== undefined ? { requestedRole: input.requestedRole } : {}),
      ...(input.requestedPermissions !== undefined
        ? { requestedPermissions: input.requestedPermissions }
        : {}),
    }),
  })
}

export type AccessRequestRow = {
  id: string
  sub: string
  iss: string
  email: string
  name: string
  message: string
  createdAt: string
  status: string
  requestedRole?: string | null
  requestedPermissions?: string[]
}

/** Caller's own pending access request, if any. */
export function fetchOwnAccessRequest(signal?: AbortSignal) {
  return authzFetch<{ request: AccessRequestRow | null }>('/auth/me/access-request', {
    signal,
  })
}

export function listAccessRequests(signal?: AbortSignal) {
  return authzFetch<{
    requests: AccessRequestRow[]
  }>('/auth/access-requests', { signal })
}

export type RbacUserRow = {
  sub: string
  iss: string
  name: string
  email: string
  role: string | null
  customPermissionCount: number
}

/** Settings → Users list (managers/admins). */
export function listRbacUsers(signal?: AbortSignal) {
  return authzFetch<{ users: RbacUserRow[] }>('/auth/grants/users', { signal })
}

export function grantRole(input: {
  sub: string
  iss: string
  role: string
  expiresAt: number
  reason: string
}) {
  return authzFetch('/auth/grants/role', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function grantPermissions(input: {
  sub: string
  iss: string
  permissions: string[]
  expiresAt: number
  reason: string
}) {
  return authzFetch('/auth/grants/permissions', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

/** Approve or deny an access request (RBAC: expiresAt / grantedRole / grantedPermissions / reason). */
export function resolveAccessRequest(
  id: string,
  body:
    | {
        action: 'approve'
        expiresAt: number
        grantedRole?: string | null
        grantedPermissions?: string[]
        reason?: string
      }
    | { action: 'deny'; reason: string },
) {
  return authzFetch(`/auth/access-requests/${encodeURIComponent(id)}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export type InstanceAdmin = {
  sub: string
  iss: string
  email?: string | null
  name?: string | null
  /** True when this Principal matches `AUTHZ_BOOTSTRAP_ADMINS`. */
  bootstrap?: boolean
}

export function fetchInstance(signal?: AbortSignal) {
  return authzFetch<{
    enforce: boolean
    admins: InstanceAdmin[]
    permissions: Array<{
      sub: string
      iss: string
      permissions: InstancePermission[]
      expiresAt: number
    }>
  }>('/auth/instance', { signal })
}

export function revokeUserSessions(target: { sub: string; iss: string }) {
  return authzFetch('/auth/instance/revoke-sessions', {
    method: 'POST',
    body: JSON.stringify(target),
  })
}

export type SuspensionHistoryEntry = {
  flag: string
  action: 'set' | 'lift'
  reason: string
  actor: string
  at: string
}

export function fetchMiceSuspension(principal: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ principal })
  return authzFetch<{ history: SuspensionHistoryEntry[] }>(
    `/auth/admin/mice-suspension?${params.toString()}`,
    { signal },
  )
}

export function setMiceSuspension(principal: string, reason: string) {
  return authzFetch('/auth/admin/mice-suspension', {
    method: 'POST',
    headers: { 'X-Mice-Reason': reason },
    body: JSON.stringify({ principal, reason }),
  })
}

export function liftMiceSuspension(principal: string, reason: string) {
  return authzFetch('/auth/admin/mice-suspension/lift', {
    method: 'POST',
    headers: { 'X-Mice-Reason': reason },
    body: JSON.stringify({ principal, reason }),
  })
}

export function setInstancePermissions(
  target: { sub: string; iss: string },
  permissions: InstancePermission[],
  expiresAt?: number,
) {
  return authzFetch('/auth/instance/permissions', {
    method: 'PUT',
    body: JSON.stringify({
      ...target,
      permissions,
      ...(expiresAt != null ? { expiresAt } : {}),
    }),
  })
}

export function fetchCustomRoles(ns: string, signal?: AbortSignal) {
  return authzFetch<{
    namespaceRoles: CustomNamespaceRole[]
    repoRoles: CustomRepoRole[]
  }>(`/auth/namespaces/${encodeURIComponent(ns)}/custom-roles`, { signal })
}

export function fetchCustomRolePermissions(ns: string, signal?: AbortSignal) {
  return authzFetch<{
    namespaceCapabilities: NamespaceCapability[]
    repoFinePermissions: RepoFinePermission[]
    repoFineImpliedMin: Record<RepoFinePermission, RepoRole>
  }>(
    `/auth/namespaces/${encodeURIComponent(ns)}/custom-roles/permissions`,
    { signal },
  )
}

export function createCustomNamespaceRole(
  ns: string,
  input: {
    name: string
    description?: string
    permissions: NamespaceCapability[]
    baseRepositoryRole?: BasePermission
  },
) {
  return authzFetch<{ ok: boolean; role: CustomNamespaceRole }>(
    `/auth/namespaces/${encodeURIComponent(ns)}/custom-roles/namespace`,
    { method: 'POST', body: JSON.stringify(input) },
  )
}

export function deleteCustomNamespaceRole(ns: string, roleId: string) {
  return authzFetch(
    `/auth/namespaces/${encodeURIComponent(ns)}/custom-roles/namespace/${encodeURIComponent(roleId)}`,
    { method: 'DELETE' },
  )
}

export function createCustomRepoRole(
  ns: string,
  input: {
    name: string
    description?: string
    base: 'read' | 'triage' | 'write' | 'maintain'
    permissions: RepoFinePermission[]
  },
) {
  return authzFetch<{ ok: boolean; role: CustomRepoRole }>(
    `/auth/namespaces/${encodeURIComponent(ns)}/custom-roles/repo`,
    { method: 'POST', body: JSON.stringify(input) },
  )
}

export function deleteCustomRepoRole(ns: string, roleId: string) {
  return authzFetch(
    `/auth/namespaces/${encodeURIComponent(ns)}/custom-roles/repo/${encodeURIComponent(roleId)}`,
    { method: 'DELETE' },
  )
}

// ── Approvers (#86, #124) ───────────────────────────────────────────────────

export type ApproverPrincipal = { sub: string; iss: string }

export type ApproverScope = { ns: string; repo?: string }

function approversPath(scope: ApproverScope): string {
  const ns = `/auth/namespaces/${encodeURIComponent(scope.ns)}`
  return scope.repo ? `${ns}/repos/${encodeURIComponent(scope.repo)}/approvers` : `${ns}/approvers`
}

export function fetchApprovers(scope: ApproverScope, signal?: AbortSignal) {
  return authzFetch<{ approvers: ApproverPrincipal[] }>(approversPath(scope), { signal })
}

export function grantApproverSeat(scope: ApproverScope, target: ApproverPrincipal) {
  return authzFetch<{ ok: boolean; approvers: ApproverPrincipal[] }>(approversPath(scope), {
    method: 'PUT',
    body: JSON.stringify({ sub: target.sub, iss: target.iss }),
  })
}

export function revokeApproverSeat(scope: ApproverScope, target: ApproverPrincipal) {
  return authzFetch<{ ok: boolean; approvers: ApproverPrincipal[] }>(approversPath(scope), {
    method: 'DELETE',
    body: JSON.stringify({ sub: target.sub, iss: target.iss }),
  })
}

export type ApproverVersion = {
  validFrom: string
  validTo: string | null
  approvers: ApproverPrincipal[]
}

export function fetchApproverHistory(scope: ApproverScope, signal?: AbortSignal) {
  return authzFetch<{ versions: ApproverVersion[] }>(`${approversPath(scope)}/history`, { signal })
}

// ── Entity history (#108, #109, #110) ───────────────────────────────────────

export type SeatVersionEntry = { kind: 'user' | 'group'; key: string; role: string }

export type NamespaceMembershipVersion = {
  validFrom: string
  validTo: string | null
  members: SeatVersionEntry[]
}

export function fetchNamespaceMembershipHistory(ns: string, signal?: AbortSignal) {
  return authzFetch<{ versions: NamespaceMembershipVersion[] }>(
    `/auth/namespaces/${encodeURIComponent(ns)}/members/history`,
    { signal },
  )
}

export type RepoCollaboratorVersion = {
  validFrom: string
  validTo: string | null
  collaborators: SeatVersionEntry[]
}

export function fetchRepoCollaboratorHistory(ns: string, repo: string, signal?: AbortSignal) {
  return authzFetch<{ versions: RepoCollaboratorVersion[] }>(
    `/auth/namespaces/${encodeURIComponent(ns)}/repos/${encodeURIComponent(repo)}/collaborators/history`,
    { signal },
  )
}

export type CustomRoleVersion = {
  validFrom: string
  validTo: string | null
  kind: 'namespace' | 'repo'
  roleId: string
  definition: {
    id?: string
    name?: string
    description?: string
    permissions?: string[]
    base?: string
    baseRepositoryRole?: string
  }
}

export function fetchCustomRoleHistory(ns: string, signal?: AbortSignal) {
  return authzFetch<{ versions: CustomRoleVersion[] }>(
    `/auth/namespaces/${encodeURIComponent(ns)}/custom-roles/history`,
    { signal },
  )
}

// ── Signature revoke (#93) ──────────────────────────────────────────────────

export type SignatureRevocationResult = {
  revocation: {
    id: string
    signatureId: string
    revokedAt: string
    reason: string
    changeControlId: string
    commitIds: string[]
  }
  blockedMergeRequestIds: string[]
}

/** Append-only revoke; the reason ceremony runs through `authzFetch` → `withReason`. */
export function revokeSignature(signatureId: string, input?: { commitIds?: string[]; mergeRequestId?: string }) {
  return authzFetch<SignatureRevocationResult>(
    `/auth/signatures/${encodeURIComponent(signatureId)}/revoke`,
    { method: 'POST', body: JSON.stringify({ ...(input ?? {}) }) },
  )
}

// ── Restore test (#101) ─────────────────────────────────────────────────────

export type RestoreTestStatus = { passed: boolean; passedAt?: string; recordedBy?: string }

export function fetchRestoreTest(signal?: AbortSignal) {
  return authzFetch<{ restoreTest: RestoreTestStatus }>('/auth/admin/restore-test', { signal })
}

export function recordRestoreTestPass() {
  return authzFetch<{ restoreTest: RestoreTestStatus }>('/auth/admin/restore-test/pass', {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export type { AuthUser }
