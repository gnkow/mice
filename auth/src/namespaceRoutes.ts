import type { Hono } from 'hono'
import { env } from './env.js'
import { decideInstanceAction, decideManageApprovers, decideManageRepoCollaborators, decideNamespaceAction } from './authz.js'
import { grantApprover, listApprovers, revokeApprover } from './authzApproverStore.js'
import { denialResponse } from './decisionHttp.js'
import {
  isCustomRepoRoleAssigned,
  listRepoCollaboratorHistory,
  listRepoCollaborators,
  removeRepoCollaborator,
  removeRepoGroupCollaborator,
  setRepoCollaborator,
  setRepoGroupCollaborator,
} from './authzCollaboratorStore.js'
import { isCustomNamespaceRoleAssigned, listNamespaceMembers, namespaceGroupBindingWarning, reconcileNamespaceGroupIds, removeNamespaceGroupMember, removeNamespaceMember, setNamespaceGroupMember, setNamespaceMember } from './authzMembershipStore.js'
import {
  createNamespaceAuthz,
  deleteNamespaceAuthz,
  getNamespace,
  listNamespaceMembershipHistory,
  listNamespaceSettingsHistory,
  listNamespacesForUser,
  updateNamespaceSettings,
} from './authzNamespaceStore.js'
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
import type { AuditDep } from './routeDeps.js'
import { guarded } from './authentication/index.js'

function memberTarget(body: {
  kind?: 'user' | 'group'
  sub?: string
  iss?: string
  group?: string
  name?: string
}): Record<string, unknown> {
  const kind = body.kind ?? (body.group && !body.sub ? 'group' : 'user')
  const name = body.name?.trim()
  return kind === 'group'
    ? { kind, group: body.group, ...(name ? { name } : {}) }
    : { kind, sub: body.sub, iss: body.iss }
}

/** Namespaces, members, repo collaborators and custom roles. */
export function registerNamespaceRoutes(app: Hono, { audit: auditMutation }: AuditDep): void {
  app.get('/auth/namespaces', guarded({}, async ({ c, user: session }) => {
    return c.json({ namespaces: await listNamespacesForUser(session) })
  }))

  app.post('/auth/namespaces', guarded({ mutates: true }, async ({ c, user: session }) => {
    const denied = denialResponse(c, await decideInstanceAction(session, 'namespace.create'))
    if (denied) return denied
    let body: {
      name?: string
      description?: string
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
    const description = typeof body.description === 'string' ? body.description : ''
    const result = await createNamespaceAuthz(
      session,
      body.name,
      body.basePermission,
      body.membersCanCreateRepos ?? true,
      description,
    )
    if (!result.ok) return c.json({ error: result.error }, 400)
    const name = body.name.trim()
    await auditMutation(c, session, 'session', {
      action: 'namespace.create',
      namespace: name,
      message: `Created namespace ${name}`,
      detail: {
        basePermission: body.basePermission,
        membersCanCreateRepos: body.membersCanCreateRepos ?? true,
        description,
      },
    })
    return c.json({
      ok: true,
      name,
      namespace: await getNamespace(name),
    })
  }))

  app.get('/auth/namespaces/:ns', guarded({}, async ({ c, user: session }) => {
    const ns = c.req.param('ns')
    const settings = await getNamespace(ns)
    if (!settings) return c.json({ error: 'Not found' }, 404)
    const denied = denialResponse(c, await decideNamespaceAction(session, ns, 'namespace.view'))
    if (denied) return denied
    const unresolvedGroups = await reconcileNamespaceGroupIds(ns)
    const members = await listNamespaceMembers(ns)
    const groupBindingWarning = await namespaceGroupBindingWarning(ns)
    return c.json({
      ...settings,
      name: ns,
      members,
      unresolvedGroups,
      ...(groupBindingWarning ? { groupBindingWarning } : {}),
    })
  }))

  app.get('/auth/namespaces/:ns/settings/history', guarded({}, async ({ c, user: session }) => {
    const ns = c.req.param('ns')
    const denied = denialResponse(c, await decideNamespaceAction(session, ns, 'namespace.settings'))
    if (denied) return denied
    const versions = await listNamespaceSettingsHistory(ns)
    if (!versions) return c.json({ error: 'Not found' }, 404)
    return c.json({ versions })
  }))

  app.get('/auth/namespaces/:ns/members/history', guarded({}, async ({ c, user: session }) => {
    const ns = c.req.param('ns')
    const denied = denialResponse(c, await decideNamespaceAction(session, ns, 'namespace.members.manage'))
    if (denied) return denied
    const versions = await listNamespaceMembershipHistory(ns)
    if (!versions) return c.json({ error: 'Not found' }, 404)
    return c.json({ versions })
  }))

  app.patch('/auth/namespaces/:ns', guarded({ mutates: true, reason: true, body: 'optional' }, async ({ c, user: session, body: raw }) => {
    const ns = c.req.param('ns')
    const denied = denialResponse(c, await decideNamespaceAction(session, ns, 'namespace.settings'))
    if (denied) return denied
    const body = raw as Partial<{
      name: string
      description: string
      basePermission: BasePermission
      membersCanCreateRepos: boolean
    }>
    const previous = await getNamespace(ns)
    const result = await updateNamespaceSettings(ns, body)
    if (!result.ok) return c.json({ error: result.error }, 400)
    const currentName = body.name?.trim() || ns
    const updated = await getNamespace(currentName)
    await auditMutation(c, session, 'session', {
      action: 'namespace.settings.update',
      namespace: currentName,
      message: `Updated settings for namespace ${currentName}`,
      detail: {
        previous: previous && {
          id: previous.id,
          name: previous.name,
          description: previous.description,
          basePermission: previous.basePermission,
          membersCanCreateRepos: previous.membersCanCreateRepos,
        },
        next: {
          name: body.name,
          description: body.description,
          basePermission: body.basePermission,
          membersCanCreateRepos: body.membersCanCreateRepos,
        },
      },
    })
    return c.json({ ok: true, id: updated?.id, name: currentName, namespace: updated })
  }))

  /**
   * Delete namespace AuthZ (and optionally all oxen repositories under it).
   * Body: { deleteRepositories?: boolean } — default true.
   * Owners or instance admins only.
   */
  app.delete('/auth/namespaces/:ns', guarded({ mutates: true, reason: true, body: 'optional' }, async ({ c, user: session, body: raw }) => {
    const ns = c.req.param('ns')
    const denied = denialResponse(c, await decideNamespaceAction(session, ns, 'namespace.delete'))
    if (denied) return denied
    if (!await getNamespace(ns)) return c.json({ error: 'Not found' }, 404)

    const deleteRepositories =
      typeof raw.deleteRepositories === 'boolean' ? raw.deleteRepositories : true

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
            await auditMutation(c, session, 'session', {
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

    const result = await deleteNamespaceAuthz(ns)
    if (!result.ok) return c.json({ error: result.error }, 400)

    await auditMutation(c, session, 'session', {
      action: 'namespace.delete',
      namespace: ns,
      message: `Deleted namespace ${ns}`,
      detail: { deletedRepos, deleteRepositories },
    })

    return c.json({ ok: true, deletedRepositories: deletedRepos })
  }))

  app.put('/auth/namespaces/:ns/members', guarded({ mutates: true, reason: true, body: 'optional' }, async ({ c, user: session, body: raw }) => {
    const ns = c.req.param('ns')
    const denied = denialResponse(c, await decideNamespaceAction(session, ns, 'namespace.members.manage'))
    if (denied) return denied
    const body = raw as {
      kind?: 'user' | 'group'
      sub?: string
      iss?: string
      group?: string
      name?: string
      role?: MemberRoleRef
    }
    if (!body.role) return c.json({ error: 'role required' }, 400)
    const kind = body.kind ?? (body.group && !body.sub ? 'group' : 'user')
    if (kind === 'group') {
      if (!body.group) return c.json({ error: 'group required' }, 400)
      const result = await setNamespaceGroupMember(ns, body.group, body.role, {
        displayName: body.name,
      })
      if (!result.ok) return c.json({ error: result.error }, 400)
    } else {
      if (!body.sub || !body.iss) {
        return c.json({ error: 'sub, iss, role required' }, 400)
      }
      const result = await setNamespaceMember(
        ns,
        { sub: body.sub, iss: body.iss },
        body.role,
      )
      if (!result.ok) return c.json({ error: result.error }, 400)
    }
    await auditMutation(c, session, 'session', {
      action: 'namespace.member.set',
      namespace: ns,
      message: `Set namespace member role ${body.role}`,
      detail: { target: memberTarget(body), role: body.role },
    })
    return c.json({ ok: true, members: await listNamespaceMembers(ns) })
  }))

  app.delete('/auth/namespaces/:ns/members', guarded({ mutates: true, reason: true, body: 'optional' }, async ({ c, user: session, body: raw }) => {
    const ns = c.req.param('ns')
    const denied = denialResponse(c, await decideNamespaceAction(session, ns, 'namespace.members.manage'))
    if (denied) return denied
    const body = raw as {
      kind?: 'user' | 'group'
      sub?: string
      iss?: string
      group?: string
    }
    const kind = body.kind ?? (body.group && !body.sub ? 'group' : 'user')
    if (kind === 'group') {
      if (!body.group) return c.json({ error: 'group required' }, 400)
      const result = await removeNamespaceGroupMember(ns, body.group)
      if (!result.ok) return c.json({ error: result.error }, 400)
    } else {
      if (!body.sub || !body.iss) {
        return c.json({ error: 'sub and iss required' }, 400)
      }
      const result = await removeNamespaceMember(ns, { sub: body.sub, iss: body.iss })
      if (!result.ok) return c.json({ error: result.error }, 400)
    }
    await auditMutation(c, session, 'session', {
      action: 'namespace.member.remove',
      namespace: ns,
      message: 'Removed namespace member',
      detail: { target: memberTarget(body) },
    })
    return c.json({ ok: true, members: await listNamespaceMembers(ns) })
  }))

  app.get('/auth/namespaces/:ns/repos/:repo/collaborators', guarded({}, async ({ c, user: session }) => {
    const ns = c.req.param('ns')
    const repo = c.req.param('repo')
    const denied = denialResponse(c, await decideManageRepoCollaborators(session, ns, repo))
    if (denied) return denied
    return c.json({ collaborators: await listRepoCollaborators(ns, repo) })
  }))

  app.get('/auth/namespaces/:ns/repos/:repo/collaborators/history', guarded({}, async ({ c, user: session }) => {
    const ns = c.req.param('ns')
    const repo = c.req.param('repo')
    const denied = denialResponse(c, await decideManageRepoCollaborators(session, ns, repo))
    if (denied) return denied
    const versions = await listRepoCollaboratorHistory(ns, repo)
    if (!versions) return c.json({ error: 'Not found' }, 404)
    return c.json({ versions })
  }))

  app.put('/auth/namespaces/:ns/repos/:repo/collaborators', guarded({ mutates: true, reason: true, body: 'optional' }, async ({ c, user: session, body: raw }) => {
    const ns = c.req.param('ns')
    const repo = c.req.param('repo')
    const denied = denialResponse(c, await decideManageRepoCollaborators(session, ns, repo))
    if (denied) return denied
    const body = raw as {
      kind?: 'user' | 'group'
      sub?: string
      iss?: string
      group?: string
      name?: string
      role?: CollaboratorRoleRef
    }
    if (!body.role) return c.json({ error: 'role required' }, 400)
    const kind = body.kind ?? (body.group && !body.sub ? 'group' : 'user')
    if (kind === 'group') {
      if (!body.group) return c.json({ error: 'group required' }, 400)
      const result = await setRepoGroupCollaborator(ns, repo, body.group, body.role, {
        displayName: body.name,
      })
      if (!result.ok) return c.json({ error: result.error }, 400)
    } else {
      if (!body.sub || !body.iss) {
        return c.json({ error: 'sub, iss, role required' }, 400)
      }
      const result = await setRepoCollaborator(
        ns,
        repo,
        { sub: body.sub, iss: body.iss },
        body.role,
      )
      if (!result.ok) return c.json({ error: result.error }, 400)
    }
    await auditMutation(c, session, 'session', {
      action: 'repo.collaborator.set',
      namespace: ns,
      repo,
      message: `Set repository collaborator role ${body.role}`,
      detail: { target: memberTarget(body), role: body.role },
    })
    return c.json({ ok: true, collaborators: await listRepoCollaborators(ns, repo) })
  }))

  app.delete('/auth/namespaces/:ns/repos/:repo/collaborators', guarded({ mutates: true, reason: true, body: 'optional' }, async ({ c, user: session, body: raw }) => {
    const ns = c.req.param('ns')
    const repo = c.req.param('repo')
    const denied = denialResponse(c, await decideManageRepoCollaborators(session, ns, repo))
    if (denied) return denied
    const body = raw as {
      kind?: 'user' | 'group'
      sub?: string
      iss?: string
      group?: string
    }
    const kind = body.kind ?? (body.group && !body.sub ? 'group' : 'user')
    if (kind === 'group') {
      if (!body.group) return c.json({ error: 'group required' }, 400)
      await removeRepoGroupCollaborator(ns, repo, body.group)
    } else {
      if (!body.sub || !body.iss) {
        return c.json({ error: 'sub and iss required' }, 400)
      }
      await removeRepoCollaborator(ns, repo, { sub: body.sub, iss: body.iss })
    }
    await auditMutation(c, session, 'session', {
      action: 'repo.collaborator.remove',
      namespace: ns,
      repo,
      message: 'Removed repository collaborator',
      detail: { target: memberTarget(body) },
    })
    return c.json({ ok: true, collaborators: await listRepoCollaborators(ns, repo) })
  }))

  for (const base of ['/auth/namespaces/:ns/approvers', '/auth/namespaces/:ns/repos/:repo/approvers']) {
    const scopeOf = (c: { req: { param(k: string): string | undefined } }) => {
      const repo = c.req.param('repo')
      return { ns: c.req.param('ns') as string, ...(repo ? { repo } : {}) }
    }

    app.get(base, guarded({}, async ({ c, user: session }) => {
      const scope = scopeOf(c)
      const denied = denialResponse(c, await decideNamespaceAction(session, scope.ns, 'namespace.view'))
      if (denied) return denied
      return c.json({ approvers: await listApprovers(scope) })
    }))

    app.put(base, guarded({ mutates: true, reason: true, body: 'optional' }, async ({ c, user: session, body: raw }) => {
      const scope = scopeOf(c)
      const denied = denialResponse(c, await decideManageApprovers(session, scope.ns))
      if (denied) return denied
      const body = raw as { sub?: string; iss?: string }
      if (!body.sub || !body.iss) return c.json({ error: 'sub and iss required' }, 400)
      if (!(await grantApprover(scope, { sub: body.sub, iss: body.iss }))) return c.json({ error: 'Not found' }, 404)
      await auditMutation(c, session, 'session', {
        action: 'approver.grant',
        namespace: scope.ns,
        ...(scope.repo ? { repo: scope.repo } : {}),
        message: 'Assigned approver role',
        detail: { target: memberTarget(body) },
      })
      return c.json({ ok: true, approvers: await listApprovers(scope) })
    }))

    app.delete(base, guarded({ mutates: true, reason: true, body: 'optional' }, async ({ c, user: session, body: raw }) => {
      const scope = scopeOf(c)
      const denied = denialResponse(c, await decideManageApprovers(session, scope.ns))
      if (denied) return denied
      const body = raw as { sub?: string; iss?: string }
      if (!body.sub || !body.iss) return c.json({ error: 'sub and iss required' }, 400)
      await revokeApprover(scope, { sub: body.sub, iss: body.iss })
      await auditMutation(c, session, 'session', {
        action: 'approver.revoke',
        namespace: scope.ns,
        ...(scope.repo ? { repo: scope.repo } : {}),
        message: 'Removed approver role',
        detail: { target: memberTarget(body) },
      })
      return c.json({ ok: true, approvers: await listApprovers(scope) })
    }))
  }

  app.get('/auth/namespaces/:ns/custom-roles/permissions', guarded({}, async ({ c, user: session }) => {
    const ns = c.req.param('ns')
    const denied = denialResponse(c, await decideNamespaceAction(session, ns, 'namespace.view'))
    if (denied) return denied
    return c.json({
      namespaceCapabilities: ALL_NAMESPACE_CAPABILITIES,
      repoFinePermissions: ALL_REPO_FINE_PERMISSIONS,
      repoFineImpliedMin: REPO_FINE_IMPLIED_MIN,
    })
  }))

  app.get('/auth/namespaces/:ns/custom-roles', guarded({}, async ({ c, user: session }) => {
    const ns = c.req.param('ns')
    if (!await getNamespace(ns)) return c.json({ error: 'Not found' }, 404)
    const denied = denialResponse(c, await decideNamespaceAction(session, ns, 'namespace.view'))
    if (denied) return denied
    return c.json({
      namespaceRoles: await listCustomNamespaceRoles(ns),
      repoRoles: await listCustomRepoRoles(ns),
    })
  }))

  app.post('/auth/namespaces/:ns/custom-roles/namespace', guarded({ mutates: true, reason: true, body: 'optional' }, async ({ c, user: session, body: raw }) => {
    const ns = c.req.param('ns')
    const denied = denialResponse(c, await decideNamespaceAction(session, ns, 'namespace.roles.manage'))
    if (denied) return denied
    if (!await getNamespace(ns)) return c.json({ error: 'Not found' }, 404)
    const body = raw as {
      name?: string
      description?: string
      permissions?: NamespaceCapability[]
      baseRepositoryRole?: BasePermission
    }
    if (!body.name || !body.permissions) {
      return c.json({ error: 'name and permissions required' }, 400)
    }
    const result = await createCustomNamespaceRole(ns, {
      name: body.name,
      description: body.description,
      permissions: body.permissions,
      baseRepositoryRole: body.baseRepositoryRole,
    })
    if (!result.ok) return c.json({ error: result.error }, 400)
    await auditMutation(c, session, 'session', {
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

  app.patch('/auth/namespaces/:ns/custom-roles/namespace/:roleId', guarded({ mutates: true, reason: true, body: 'optional' }, async ({ c, user: session, body: raw }) => {
    const ns = c.req.param('ns')
    const roleId = c.req.param('roleId')
    const denied = denialResponse(c, await decideNamespaceAction(session, ns, 'namespace.roles.manage'))
    if (denied) return denied
    const body = raw as Partial<{
      name: string
      description: string | null
      permissions: NamespaceCapability[]
      baseRepositoryRole: BasePermission | null
    }>
    const result = await updateCustomNamespaceRole(ns, roleId, body)
    if (!result.ok) return c.json({ error: result.error }, 400)
    await auditMutation(c, session, 'session', {
      action: 'custom-role.namespace.update',
      namespace: ns,
      message: `Updated namespace role ${roleId}`,
      detail: { roleId, changes: body },
    })
    return c.json({ ok: true, role: result.role })
  }))

  app.delete('/auth/namespaces/:ns/custom-roles/namespace/:roleId', guarded({ mutates: true, reason: true, body: 'optional' }, async ({ c, user: session, body: raw }) => {
    const ns = c.req.param('ns')
    const roleId = c.req.param('roleId')
    const denied = denialResponse(c, await decideNamespaceAction(session, ns, 'namespace.roles.manage'))
    if (denied) return denied
    const result = await deleteCustomNamespaceRole(
      ns,
      roleId,
      await isCustomNamespaceRoleAssigned(ns, roleId),
    )
    if (!result.ok) return c.json({ error: result.error }, 400)
    await auditMutation(c, session, 'session', {
      action: 'custom-role.namespace.delete',
      namespace: ns,
      message: `Deleted namespace role ${roleId}`,
      detail: { roleId },
    })
    return c.json({ ok: true })
  }))

  app.post('/auth/namespaces/:ns/custom-roles/repo', guarded({ mutates: true, reason: true, body: 'optional' }, async ({ c, user: session, body: raw }) => {
    const ns = c.req.param('ns')
    const denied = denialResponse(c, await decideNamespaceAction(session, ns, 'namespace.roles.manage'))
    if (denied) return denied
    if (!await getNamespace(ns)) return c.json({ error: 'Not found' }, 404)
    const body = raw as {
      name?: string
      description?: string
      base?: 'read' | 'triage' | 'write' | 'maintain'
      permissions?: RepoFinePermission[]
    }
    if (!body.name || !body.base || !body.permissions) {
      return c.json({ error: 'name, base, and permissions required' }, 400)
    }
    const result = await createCustomRepoRole(ns, {
      name: body.name,
      description: body.description,
      base: body.base,
      permissions: body.permissions,
    })
    if (!result.ok) return c.json({ error: result.error }, 400)
    await auditMutation(c, session, 'session', {
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

  app.patch('/auth/namespaces/:ns/custom-roles/repo/:roleId', guarded({ mutates: true, reason: true, body: 'optional' }, async ({ c, user: session, body: raw }) => {
    const ns = c.req.param('ns')
    const roleId = c.req.param('roleId')
    const denied = denialResponse(c, await decideNamespaceAction(session, ns, 'namespace.roles.manage'))
    if (denied) return denied
    const body = raw as Partial<{
      name: string
      description: string | null
      base: 'read' | 'triage' | 'write' | 'maintain'
      permissions: RepoFinePermission[]
    }>
    const result = await updateCustomRepoRole(ns, roleId, body)
    if (!result.ok) return c.json({ error: result.error }, 400)
    await auditMutation(c, session, 'session', {
      action: 'custom-role.repo.update',
      namespace: ns,
      message: `Updated repository role ${roleId}`,
      detail: { roleId, changes: body },
    })
    return c.json({ ok: true, role: result.role })
  }))

  app.delete('/auth/namespaces/:ns/custom-roles/repo/:roleId', guarded({ mutates: true, reason: true, body: 'optional' }, async ({ c, user: session }) => {
    const ns = c.req.param('ns')
    const roleId = c.req.param('roleId')
    const denied = denialResponse(c, await decideNamespaceAction(session, ns, 'namespace.roles.manage'))
    if (denied) return denied
    const result = await deleteCustomRepoRole(
      ns,
      roleId,
      await isCustomRepoRoleAssigned(ns, roleId),
    )
    if (!result.ok) return c.json({ error: result.error }, 400)
    await auditMutation(c, session, 'session', {
      action: 'custom-role.repo.delete',
      namespace: ns,
      message: `Deleted repository role ${roleId}`,
      detail: { roleId },
    })
    return c.json({ ok: true })
  }))
}
