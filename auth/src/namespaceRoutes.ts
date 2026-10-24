import type { Hono } from 'hono'
import { env } from './env.js'
import { canManageRepoCollaborators } from './authz.js'
import { isCustomRepoRoleAssigned, listRepoCollaborators, removeRepoCollaborator, removeRepoGroupCollaborator, setRepoCollaborator, setRepoGroupCollaborator } from './authzCollaboratorStore.js'
import { hasInstancePermission, isInstanceAdmin } from './authzInstanceStore.js'
import { hasNamespaceCapability, isCustomNamespaceRoleAssigned, listNamespaceMembers, removeNamespaceGroupMember, removeNamespaceMember, resolveNamespaceRole, setNamespaceGroupMember, setNamespaceMember } from './authzMembershipStore.js'
import { createNamespaceAuthz, deleteNamespaceAuthz, getNamespace, listNamespacesForUser, updateNamespaceSettings } from './authzNamespaceStore.js'
import {
  ALL_NAMESPACE_CAPABILITIES,
  ALL_REPO_FINE_PERMISSIONS,
  REPO_FINE_IMPLIED_MIN,
  createCustomNamespaceRole,
  createCustomRepoRole,
  deleteCustomNamespaceRole,
  deleteCustomRepoRole,
  listCustomNamespaceRoles,
  listCustomRepoRoles,
  updateCustomNamespaceRole,
  updateCustomRepoRole,
} from './customRoles.js'
import type {
  BasePermission,
  CollaboratorRoleRef,
  MemberRoleRef,
  NamespaceCapability,
  RepoFinePermission,
} from './authzTypes.js'
import type { SessionUser } from './session.js'
import type { AuditDep } from './routeDeps.js'
import { guarded } from './routeGuard.js'

function memberTarget(body: {
  kind?: 'user' | 'group'
  sub?: string
  iss?: string
  group?: string
}): Record<string, unknown> {
  const kind = body.kind ?? (body.group && !body.sub ? 'group' : 'user')
  return kind === 'group'
    ? { kind, group: body.group }
    : { kind, sub: body.sub, iss: body.iss }
}

function requireOwner(session: SessionUser, ns: string): boolean {
  if (isInstanceAdmin(session)) return true
  return resolveNamespaceRole(ns, session) === 'owner'
}

function requireNsCapability(
  session: SessionUser,
  ns: string,
  cap: NamespaceCapability,
): boolean {
  return hasNamespaceCapability(ns, session, cap)
}

/** Namespaces, members, repo collaborators and custom roles. */
export function registerNamespaceRoutes(app: Hono, { audit: auditMutation }: AuditDep): void {
  app.get('/auth/namespaces', guarded({}, async ({ c, user: session }) => {
    return c.json({ namespaces: listNamespacesForUser(session) })
  }))

  app.post('/auth/namespaces', guarded({}, async ({ c, user: session }) => {
    if (
      !isInstanceAdmin(session) &&
      !hasInstancePermission(session, 'create_namespace')
    ) {
      return c.json({ error: 'Missing permission create_namespace' }, 403)
    }
    let body: {
      name?: string
      basePermission?: BasePermission
      membersCanCreateRepos?: boolean
    }
    try {
      body = (await c.req.json()) as typeof body
    } catch {
      return c.json({ error: 'Invalid body' }, 400)
    }
    if (!body.name || !body.basePermission) {
      return c.json({ error: 'name and basePermission required' }, 400)
    }
    const result = createNamespaceAuthz(
      session,
      body.name,
      body.basePermission,
      body.membersCanCreateRepos ?? true,
    )
    if (!result.ok) return c.json({ error: result.error }, 400)
    const name = body.name.trim()
    auditMutation(c, session, 'session', {
      action: 'namespace.create',
      namespace: name,
      message: `Created namespace ${name}`,
      detail: {
        basePermission: body.basePermission,
        membersCanCreateRepos: body.membersCanCreateRepos ?? true,
      },
    })
    return c.json({
      ok: true,
      name,
      namespace: getNamespace(name),
    })
  }))

  app.get('/auth/namespaces/:ns', guarded({}, async ({ c, user: session }) => {
    const ns = c.req.param('ns')
    const settings = getNamespace(ns)
    if (!settings) return c.json({ error: 'Not found' }, 404)
    if (!requireOwner(session, ns) && !resolveNamespaceRole(ns, session)) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    return c.json({
      name: ns,
      ...settings,
      members: listNamespaceMembers(ns),
    })
  }))

  app.patch('/auth/namespaces/:ns', guarded({}, async ({ c, user: session }) => {
    const ns = c.req.param('ns')
    if (!requireNsCapability(session, ns, 'manage_settings')) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    let body: Partial<{
      basePermission: BasePermission
      membersCanCreateRepos: boolean
    }>
    try {
      body = (await c.req.json()) as typeof body
    } catch {
      return c.json({ error: 'Invalid body' }, 400)
    }
    const previous = getNamespace(ns)
    const result = updateNamespaceSettings(ns, body)
    if (!result.ok) return c.json({ error: result.error }, 400)
    auditMutation(c, session, 'session', {
      action: 'namespace.settings.update',
      namespace: ns,
      message: `Updated settings for namespace ${ns}`,
      detail: {
        previous: previous && {
          basePermission: previous.basePermission,
          membersCanCreateRepos: previous.membersCanCreateRepos,
        },
        next: {
          basePermission: body.basePermission,
          membersCanCreateRepos: body.membersCanCreateRepos,
        },
      },
    })
    return c.json({ ok: true, namespace: getNamespace(ns) })
  }))

  /**
   * Delete namespace AuthZ (and optionally all oxen repositories under it).
   * Body: { deleteRepositories?: boolean } — default true.
   * Owners or instance admins only.
   */
  app.delete('/auth/namespaces/:ns', guarded({}, async ({ c, user: session }) => {
    const ns = c.req.param('ns')
    if (!requireNsCapability(session, ns, 'delete_namespace')) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    if (!getNamespace(ns)) return c.json({ error: 'Not found' }, 404)

    let deleteRepositories = true
    try {
      const body = (await c.req.json()) as { deleteRepositories?: boolean }
      if (typeof body.deleteRepositories === 'boolean') {
        deleteRepositories = body.deleteRepositories
      }
    } catch {
      /* empty body → delete repositories by default */
    }

    const deletedRepos: string[] = []
    if (deleteRepositories) {
      try {
        const listRes = await fetch(
          `${env.oxenUpstream}/api/repos/${encodeURIComponent(ns)}`,
        )
        if (listRes.ok) {
          const listBody = (await listRes.json()) as {
            repositories?: Array<{ name?: string }>
          }
          const repos = listBody.repositories ?? []
          for (const r of repos) {
            const name = r.name
            if (!name) continue
            const delRes = await fetch(
              `${env.oxenUpstream}/api/repos/${encodeURIComponent(ns)}/${encodeURIComponent(name)}`,
              { method: 'DELETE' },
            )
            if (!delRes.ok && delRes.status !== 404) {
              return c.json(
                {
                  error: `Failed to delete repository ${ns}/${name} (${delRes.status})`,
                },
                502,
              )
            }
            deletedRepos.push(name)
            auditMutation(c, session, 'session', {
              action: 'repo.delete',
              namespace: ns,
              repo: name,
              message: `Deleted repository ${ns}/${name} (namespace deletion)`,
              detail: { cascade: 'namespace.delete' },
            })
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'oxen error'
        return c.json({ error: `Failed to list/delete oxen repos: ${msg}` }, 502)
      }
    } else {
      try {
        const listRes = await fetch(
          `${env.oxenUpstream}/api/repos/${encodeURIComponent(ns)}`,
        )
        if (listRes.ok) {
          const listBody = (await listRes.json()) as {
            repositories?: unknown[]
          }
          if ((listBody.repositories ?? []).length > 0) {
            return c.json(
              {
                error:
                  'Namespace still has repositories on oxen-server. Pass deleteRepositories: true or delete them first.',
              },
              409,
            )
          }
        }
      } catch {
        /* oxen unreachable — still allow AuthZ-only cleanup */
      }
    }

    const result = deleteNamespaceAuthz(ns)
    if (!result.ok) return c.json({ error: result.error }, 400)

    auditMutation(c, session, 'session', {
      action: 'namespace.delete',
      namespace: ns,
      message: `Deleted namespace ${ns}`,
      detail: { deletedRepos, deleteRepositories },
    })

    return c.json({ ok: true, deletedRepositories: deletedRepos })
  }))

  app.put('/auth/namespaces/:ns/members', guarded({}, async ({ c, user: session }) => {
    const ns = c.req.param('ns')
    if (!requireNsCapability(session, ns, 'manage_members')) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    let body: {
      kind?: 'user' | 'group'
      sub?: string
      iss?: string
      group?: string
      role?: MemberRoleRef
    }
    try {
      body = (await c.req.json()) as typeof body
    } catch {
      return c.json({ error: 'Invalid body' }, 400)
    }
    if (!body.role) return c.json({ error: 'role required' }, 400)
    const kind = body.kind ?? (body.group && !body.sub ? 'group' : 'user')
    if (kind === 'group') {
      if (!body.group) return c.json({ error: 'group required' }, 400)
      const result = setNamespaceGroupMember(ns, body.group, body.role)
      if (!result.ok) return c.json({ error: result.error }, 400)
    } else {
      if (!body.sub || !body.iss) {
        return c.json({ error: 'sub, iss, role required' }, 400)
      }
      const result = setNamespaceMember(
        ns,
        { sub: body.sub, iss: body.iss },
        body.role,
      )
      if (!result.ok) return c.json({ error: result.error }, 400)
    }
    auditMutation(c, session, 'session', {
      action: 'namespace.member.set',
      namespace: ns,
      message: `Set namespace member role ${body.role}`,
      detail: { target: memberTarget(body), role: body.role },
    })
    return c.json({ ok: true, members: listNamespaceMembers(ns) })
  }))

  app.delete('/auth/namespaces/:ns/members', guarded({}, async ({ c, user: session }) => {
    const ns = c.req.param('ns')
    if (!requireNsCapability(session, ns, 'manage_members')) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    let body: {
      kind?: 'user' | 'group'
      sub?: string
      iss?: string
      group?: string
    }
    try {
      body = (await c.req.json()) as typeof body
    } catch {
      return c.json({ error: 'Invalid body' }, 400)
    }
    const kind = body.kind ?? (body.group && !body.sub ? 'group' : 'user')
    if (kind === 'group') {
      if (!body.group) return c.json({ error: 'group required' }, 400)
      const result = removeNamespaceGroupMember(ns, body.group)
      if (!result.ok) return c.json({ error: result.error }, 400)
    } else {
      if (!body.sub || !body.iss) {
        return c.json({ error: 'sub and iss required' }, 400)
      }
      const result = removeNamespaceMember(ns, { sub: body.sub, iss: body.iss })
      if (!result.ok) return c.json({ error: result.error }, 400)
    }
    auditMutation(c, session, 'session', {
      action: 'namespace.member.remove',
      namespace: ns,
      message: 'Removed namespace member',
      detail: { target: memberTarget(body) },
    })
    return c.json({ ok: true, members: listNamespaceMembers(ns) })
  }))

  app.get('/auth/namespaces/:ns/repos/:repo/collaborators', guarded({}, async ({ c, user: session }) => {
    const ns = c.req.param('ns')
    const repo = c.req.param('repo')
    if (!canManageRepoCollaborators(session, ns, repo)) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    return c.json({ collaborators: listRepoCollaborators(ns, repo) })
  }))

  app.put('/auth/namespaces/:ns/repos/:repo/collaborators', guarded({}, async ({ c, user: session }) => {
    const ns = c.req.param('ns')
    const repo = c.req.param('repo')
    if (!canManageRepoCollaborators(session, ns, repo)) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    let body: {
      kind?: 'user' | 'group'
      sub?: string
      iss?: string
      group?: string
      role?: CollaboratorRoleRef
    }
    try {
      body = (await c.req.json()) as typeof body
    } catch {
      return c.json({ error: 'Invalid body' }, 400)
    }
    if (!body.role) return c.json({ error: 'role required' }, 400)
    const kind = body.kind ?? (body.group && !body.sub ? 'group' : 'user')
    if (kind === 'group') {
      if (!body.group) return c.json({ error: 'group required' }, 400)
      const result = setRepoGroupCollaborator(ns, repo, body.group, body.role)
      if (!result.ok) return c.json({ error: result.error }, 400)
    } else {
      if (!body.sub || !body.iss) {
        return c.json({ error: 'sub, iss, role required' }, 400)
      }
      const result = setRepoCollaborator(
        ns,
        repo,
        { sub: body.sub, iss: body.iss },
        body.role,
      )
      if (!result.ok) return c.json({ error: result.error }, 400)
    }
    auditMutation(c, session, 'session', {
      action: 'repo.collaborator.set',
      namespace: ns,
      repo,
      message: `Set repository collaborator role ${body.role}`,
      detail: { target: memberTarget(body), role: body.role },
    })
    return c.json({ ok: true, collaborators: listRepoCollaborators(ns, repo) })
  }))

  app.delete('/auth/namespaces/:ns/repos/:repo/collaborators', guarded({}, async ({ c, user: session }) => {
    const ns = c.req.param('ns')
    const repo = c.req.param('repo')
    if (!canManageRepoCollaborators(session, ns, repo)) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    let body: {
      kind?: 'user' | 'group'
      sub?: string
      iss?: string
      group?: string
    }
    try {
      body = (await c.req.json()) as typeof body
    } catch {
      return c.json({ error: 'Invalid body' }, 400)
    }
    const kind = body.kind ?? (body.group && !body.sub ? 'group' : 'user')
    if (kind === 'group') {
      if (!body.group) return c.json({ error: 'group required' }, 400)
      removeRepoGroupCollaborator(ns, repo, body.group)
    } else {
      if (!body.sub || !body.iss) {
        return c.json({ error: 'sub and iss required' }, 400)
      }
      removeRepoCollaborator(ns, repo, { sub: body.sub, iss: body.iss })
    }
    auditMutation(c, session, 'session', {
      action: 'repo.collaborator.remove',
      namespace: ns,
      repo,
      message: 'Removed repository collaborator',
      detail: { target: memberTarget(body) },
    })
    return c.json({ ok: true, collaborators: listRepoCollaborators(ns, repo) })
  }))

  app.get('/auth/namespaces/:ns/custom-roles/permissions', guarded({}, async ({ c, user: session }) => {
    const ns = c.req.param('ns')
    if (
      !requireNsCapability(session, ns, 'manage_custom_roles') &&
      !resolveNamespaceRole(ns, session)
    ) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    return c.json({
      namespaceCapabilities: ALL_NAMESPACE_CAPABILITIES,
      repoFinePermissions: ALL_REPO_FINE_PERMISSIONS,
      repoFineImpliedMin: REPO_FINE_IMPLIED_MIN,
    })
  }))

  app.get('/auth/namespaces/:ns/custom-roles', guarded({}, async ({ c, user: session }) => {
    const ns = c.req.param('ns')
    if (!getNamespace(ns)) return c.json({ error: 'Not found' }, 404)
    if (
      !requireOwner(session, ns) &&
      !resolveNamespaceRole(ns, session) &&
      !isInstanceAdmin(session)
    ) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    return c.json({
      namespaceRoles: listCustomNamespaceRoles(ns),
      repoRoles: listCustomRepoRoles(ns),
    })
  }))

  app.post('/auth/namespaces/:ns/custom-roles/namespace', guarded({}, async ({ c, user: session }) => {
    const ns = c.req.param('ns')
    if (!requireNsCapability(session, ns, 'manage_custom_roles')) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    if (!getNamespace(ns)) return c.json({ error: 'Not found' }, 404)
    let body: {
      name?: string
      description?: string
      permissions?: NamespaceCapability[]
      baseRepositoryRole?: BasePermission
    }
    try {
      body = (await c.req.json()) as typeof body
    } catch {
      return c.json({ error: 'Invalid body' }, 400)
    }
    if (!body.name || !body.permissions) {
      return c.json({ error: 'name and permissions required' }, 400)
    }
    const result = createCustomNamespaceRole(ns, {
      name: body.name,
      description: body.description,
      permissions: body.permissions,
      baseRepositoryRole: body.baseRepositoryRole,
    })
    if (!result.ok) return c.json({ error: result.error }, 400)
    auditMutation(c, session, 'session', {
      action: 'custom-role.namespace.create',
      namespace: ns,
      message: `Created namespace role ${body.name}`,
      detail: {
        roleId: result.role.id,
        permissions: body.permissions,
        baseRepositoryRole: body.baseRepositoryRole,
      },
    })
    return c.json({ ok: true, role: result.role })
  }))

  app.patch('/auth/namespaces/:ns/custom-roles/namespace/:roleId', guarded({}, async ({ c, user: session }) => {
    const ns = c.req.param('ns')
    const roleId = c.req.param('roleId')
    if (!requireNsCapability(session, ns, 'manage_custom_roles')) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    let body: Partial<{
      name: string
      description: string | null
      permissions: NamespaceCapability[]
      baseRepositoryRole: BasePermission | null
    }>
    try {
      body = (await c.req.json()) as typeof body
    } catch {
      return c.json({ error: 'Invalid body' }, 400)
    }
    const result = updateCustomNamespaceRole(ns, roleId, body)
    if (!result.ok) return c.json({ error: result.error }, 400)
    auditMutation(c, session, 'session', {
      action: 'custom-role.namespace.update',
      namespace: ns,
      message: `Updated namespace role ${roleId}`,
      detail: { roleId, changes: body },
    })
    return c.json({ ok: true, role: result.role })
  }))

  app.delete('/auth/namespaces/:ns/custom-roles/namespace/:roleId', guarded({}, async ({ c, user: session }) => {
    const ns = c.req.param('ns')
    const roleId = c.req.param('roleId')
    if (!requireNsCapability(session, ns, 'manage_custom_roles')) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    const result = deleteCustomNamespaceRole(
      ns,
      roleId,
      isCustomNamespaceRoleAssigned(ns, roleId),
    )
    if (!result.ok) return c.json({ error: result.error }, 400)
    auditMutation(c, session, 'session', {
      action: 'custom-role.namespace.delete',
      namespace: ns,
      message: `Deleted namespace role ${roleId}`,
      detail: { roleId },
    })
    return c.json({ ok: true })
  }))

  app.post('/auth/namespaces/:ns/custom-roles/repo', guarded({}, async ({ c, user: session }) => {
    const ns = c.req.param('ns')
    if (!requireNsCapability(session, ns, 'manage_custom_roles')) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    if (!getNamespace(ns)) return c.json({ error: 'Not found' }, 404)
    let body: {
      name?: string
      description?: string
      base?: 'read' | 'triage' | 'write' | 'maintain'
      permissions?: RepoFinePermission[]
    }
    try {
      body = (await c.req.json()) as typeof body
    } catch {
      return c.json({ error: 'Invalid body' }, 400)
    }
    if (!body.name || !body.base || !body.permissions) {
      return c.json({ error: 'name, base, and permissions required' }, 400)
    }
    const result = createCustomRepoRole(ns, {
      name: body.name,
      description: body.description,
      base: body.base,
      permissions: body.permissions,
    })
    if (!result.ok) return c.json({ error: result.error }, 400)
    auditMutation(c, session, 'session', {
      action: 'custom-role.repo.create',
      namespace: ns,
      message: `Created repository role ${body.name}`,
      detail: {
        roleId: result.role.id,
        base: body.base,
        permissions: body.permissions,
      },
    })
    return c.json({ ok: true, role: result.role })
  }))

  app.patch('/auth/namespaces/:ns/custom-roles/repo/:roleId', guarded({}, async ({ c, user: session }) => {
    const ns = c.req.param('ns')
    const roleId = c.req.param('roleId')
    if (!requireNsCapability(session, ns, 'manage_custom_roles')) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    let body: Partial<{
      name: string
      description: string | null
      base: 'read' | 'triage' | 'write' | 'maintain'
      permissions: RepoFinePermission[]
    }>
    try {
      body = (await c.req.json()) as typeof body
    } catch {
      return c.json({ error: 'Invalid body' }, 400)
    }
    const result = updateCustomRepoRole(ns, roleId, body)
    if (!result.ok) return c.json({ error: result.error }, 400)
    auditMutation(c, session, 'session', {
      action: 'custom-role.repo.update',
      namespace: ns,
      message: `Updated repository role ${roleId}`,
      detail: { roleId, changes: body },
    })
    return c.json({ ok: true, role: result.role })
  }))

  app.delete('/auth/namespaces/:ns/custom-roles/repo/:roleId', guarded({}, async ({ c, user: session }) => {
    const ns = c.req.param('ns')
    const roleId = c.req.param('roleId')
    if (!requireNsCapability(session, ns, 'manage_custom_roles')) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    const result = deleteCustomRepoRole(
      ns,
      roleId,
      isCustomRepoRoleAssigned(ns, roleId),
    )
    if (!result.ok) return c.json({ error: result.error }, 400)
    auditMutation(c, session, 'session', {
      action: 'custom-role.repo.delete',
      namespace: ns,
      message: `Deleted repository role ${roleId}`,
      detail: { roleId },
    })
    return c.json({ ok: true })
  }))
}
