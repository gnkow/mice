import type { AuthUser } from './auth'

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

export type MemberPrincipal =
  | { kind: 'user'; sub: string; iss: string; role: MemberRoleRef }
  | { kind: 'group'; group: string; role: MemberRoleRef }

export type CollaboratorPrincipal =
  | { kind: 'user'; sub: string; iss: string; role: CollaboratorRoleRef }
  | { kind: 'group'; group: string; role: CollaboratorRoleRef }

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
  role: MemberRoleRef
}): MemberPrincipal {
  if (m.kind === 'group' || (m.group && !m.sub)) {
    return { kind: 'group', group: String(m.group ?? ''), role: m.role }
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
  role: CollaboratorRoleRef
}): CollaboratorPrincipal {
  if (c.kind === 'group' || (c.group && !c.sub)) {
    return { kind: 'group', group: String(c.group ?? ''), role: c.role }
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

export async function authzFetch<T>(
  path: string,
  init?: RequestInit & { signal?: AbortSignal },
): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
    ...init,
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
    const err = body as { error?: string }
    throw new Error(err.error || `AuthZ ${res.status}`)
  }
  return body as T
}

export async function fetchNamespaceAuthz(ns: string, signal?: AbortSignal) {
  const data = await authzFetch<{
    name: string
    basePermission: BasePermission
    membersCanCreateRepos: boolean
    members: Array<
      MemberPrincipal | { sub: string; iss: string; role: MemberRoleRef }
    >
  }>(`/auth/namespaces/${encodeURIComponent(ns)}`, { signal })
  return {
    ...data,
    members: data.members.map(normalizeMember),
  }
}

export function patchNamespaceAuthz(
  ns: string,
  patch: Partial<{
    basePermission: BasePermission
    membersCanCreateRepos: boolean
  }>,
) {
  return authzFetch(`/auth/namespaces/${encodeURIComponent(ns)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

export function putNamespaceMember(
  ns: string,
  member:
    | { kind?: 'user'; sub: string; iss: string; role: MemberRoleRef }
    | { kind: 'group'; group: string; role: MemberRoleRef },
) {
  return authzFetch(`/auth/namespaces/${encodeURIComponent(ns)}/members`, {
    method: 'PUT',
    body: JSON.stringify(
      member.kind === 'group'
        ? { kind: 'group', group: member.group, role: member.role }
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
  name: string
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
    | { kind: 'group'; group: string; role: CollaboratorRoleRef },
) {
  return authzFetch(
    `/auth/namespaces/${encodeURIComponent(ns)}/repos/${encodeURIComponent(repo)}/collaborators`,
    {
      method: 'PUT',
      body: JSON.stringify(
        collab.kind === 'group'
          ? { kind: 'group', group: collab.group, role: collab.role }
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

export function submitAccessRequest(message?: string) {
  return authzFetch('/auth/access-requests', {
    method: 'POST',
    body: JSON.stringify({ message: message ?? '' }),
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
}

export function listAccessRequests(signal?: AbortSignal) {
  return authzFetch<{
    requests: AccessRequestRow[]
    reviewNamespaces: string[]
  }>('/auth/access-requests', { signal })
}

export function resolveAccessRequest(
  id: string,
  action: 'approve' | 'deny',
  grant?: {
    namespace?: string
    role?: MemberRoleRef
    permission?: InstancePermission
  },
) {
  return authzFetch(`/auth/access-requests/${encodeURIComponent(id)}`, {
    method: 'POST',
    body: JSON.stringify({ action, ...grant }),
  })
}

export type InstanceAdmin = { sub: string; iss: string }

export function fetchInstance(signal?: AbortSignal) {
  return authzFetch<{
    enforce: boolean
    admins: InstanceAdmin[]
    permissions: Array<{
      sub: string
      iss: string
      permissions: InstancePermission[]
    }>
  }>('/auth/instance', { signal })
}

export function patchInstanceEnforce(enforce: boolean) {
  return authzFetch<{ enforce: boolean }>('/auth/instance', {
    method: 'PATCH',
    body: JSON.stringify({ enforce }),
  })
}

export function addInstanceAdmin(target: { sub: string; iss: string }) {
  return authzFetch('/auth/instance/admins', {
    method: 'POST',
    body: JSON.stringify(target),
  })
}

export function removeInstanceAdmin(target: { sub: string; iss: string }) {
  return authzFetch('/auth/instance/admins', {
    method: 'DELETE',
    body: JSON.stringify(target),
  })
}

export function setInstancePermissions(
  target: { sub: string; iss: string },
  permissions: InstancePermission[],
) {
  return authzFetch('/auth/instance/permissions', {
    method: 'PUT',
    body: JSON.stringify({ ...target, permissions }),
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

export type { AuthUser }
