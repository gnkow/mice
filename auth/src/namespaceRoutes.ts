import type { Hono } from 'hono'
import { env } from './env.js'
import {
  canAdministerRepository,
  decideInstanceAction,
  decideManageApprovers,
  decideManageRepoCollaborators,
  decideNamespaceAction,
  hasRepoPermission,
} from './authz.js'
import { decideRepoViewerPermissions } from './repoViewerPermissions.js'
import {
  listApproverHistory,
  listApprovers,
  mutateApproverSeat,
  type ApproverTargetBody,
} from './authzApproverStore.js'
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
  listRepositorySettingsVersions,
  readRepository,
  readRepositoryById,
  renameRepository,
  updateRepositoryDescription,
} from './repositoryStore.js'
import {
  ALL_NAMESPACE_CAPABILITIES,
  ALL_REPO_FINE_PERMISSIONS,
  REPO_FINE_IMPLIED_MIN,
  createCustomNamespaceRole,
  createCustomRepoRole,
  deleteCustomNamespaceRole,
  deleteCustomRepoRole,
  getCustomNamespaceRole,
  getCustomRepoRole,
  listCustomNamespaceRoles,
  listCustomRepoRoles,
  listCustomRoleVersions,
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
import { requireAuditChange } from './auditChange.js'
import { captureBefore, pickSnapshot, principalRole, principalSeat } from './auditSnapshot.js'
import { guarded } from './authentication/index.js'

const NS_SNAPSHOT_KEYS = ['id', 'name', 'description', 'basePermission', 'membersCanCreateRepos'] as const
const REPO_SNAPSHOT_KEYS = ['id', 'namespace', 'name', 'description'] as const

function nsSnapshot(ns: Awaited<ReturnType<typeof getNamespace>>): Record<string, unknown> | null {
  return pickSnapshot(ns, NS_SNAPSHOT_KEYS)
}

function repoSnapshot(repo: Awaited<ReturnType<typeof readRepository>>): Record<string, unknown> | null {
  return pickSnapshot(repo, REPO_SNAPSHOT_KEYS)
}

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

  app.post('/auth/namespaces', guarded({ mutates: true, action: 'namespace.create' }, async ({ c, user: session }) => {
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
    const created = await getNamespace(name)
    await auditMutation(c, session, 'session', {
      action: 'namespace.create',
      change: requireAuditChange(
        null,
        nsSnapshot(created) ?? {
          id: result.id,
          name,
          description,
          basePermission: body.basePermission,
          membersCanCreateRepos: body.membersCanCreateRepos ?? true,
        },
      ),
      namespace: name,
      message: `Created namespace ${name}`,
      detail: {
        id: result.id,
        basePermission: body.basePermission,
        membersCanCreateRepos: body.membersCanCreateRepos ?? true,
        description,
      },
    })
    return c.json({
      ok: true,
      id: result.id,
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
    const [
      manageSettings,
      manageMembers,
      manageCustomRoles,
      deleteNamespace,
      manageApprovers,
    ] = await Promise.all([
      decideNamespaceAction(session, ns, 'namespace.settings'),
      decideNamespaceAction(session, ns, 'namespace.members.manage'),
      decideNamespaceAction(session, ns, 'namespace.roles.manage'),
      decideNamespaceAction(session, ns, 'namespace.delete'),
      decideManageApprovers(session, ns),
    ])
    return c.json({
      ...settings,
      name: ns,
      members,
      unresolvedGroups,
      ...(groupBindingWarning ? { groupBindingWarning } : {}),
      permissions: {
        manageSettings: manageSettings.allow,
        manageMembers: manageMembers.allow,
        manageCustomRoles: manageCustomRoles.allow,
        deleteNamespace: deleteNamespace.allow,
        manageApprovers: manageApprovers.allow,
      },
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

  app.patch('/auth/namespaces/:ns', guarded({ mutates: true, action: 'namespace.settings.update', reason: true, body: 'optional' }, async ({ c, user: session, body: raw }) => {
    const ns = c.req.param('ns')
    const denied = denialResponse(c, await decideNamespaceAction(session, ns, 'namespace.settings'))
    if (denied) return denied
    const body = raw as Partial<{
      name: string
      description: string
      basePermission: BasePermission
      membersCanCreateRepos: boolean
    }>
    const previous = await captureBefore(() => getNamespace(ns))
    if (!previous) return c.json({ error: 'Not found' }, 404)
    const nextName = body.name?.trim()
    // Display-name rename only: oxen paths use stable namespace UUIDs (no transfer).
    const result = await updateNamespaceSettings(ns, body)
    if (!result.ok) return c.json({ error: result.error }, 400)
    const currentName = nextName || ns
    const updated = await getNamespace(currentName)
    const settingsChange = requireAuditChange(nsSnapshot(previous), nsSnapshot(updated))
    await auditMutation(c, session, 'session', {
      action: 'namespace.settings.update',
      change: settingsChange,
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
  app.delete('/auth/namespaces/:ns', guarded({ mutates: true, action: 'namespace.delete', reason: true, body: 'optional' }, async ({ c, user: session, body: raw }) => {
    const ns = c.req.param('ns')
    const denied = denialResponse(c, await decideNamespaceAction(session, ns, 'namespace.delete'))
    if (denied) return denied
    const settings = await getNamespace(ns)
    if (!settings) return c.json({ error: 'Not found' }, 404)
    // Oxen stores the namespace under its stable AuthZ id, not the display name.
    const physicalNs = settings.id

    const deleteRepositories =
      typeof raw.deleteRepositories === 'boolean' ? raw.deleteRepositories : true

    const deletedRepos: string[] = []
    const deletedRecords = new Map<string, Awaited<ReturnType<typeof readRepositoryById>>>()
    if (deleteRepositories) {
      try {
        const listRes = await fetch(
          `${env.oxenUpstream}/api/repos/${encodeURIComponent(physicalNs)}`,
        )
        if (listRes.ok) {
          const listBody = (await listRes.json()) as {
            repositories?: Array<{ name?: string }>
          }
          const repos = listBody.repositories ?? []
          for (const r of repos) {
            const physicalRepo = r.name
            if (!physicalRepo) continue
            // Fail-closed: snapshot the repository record before it is deleted.
            deletedRecords.set(physicalRepo, await captureBefore(() => readRepositoryById(physicalRepo)))
            const delRes = await fetch(
              `${env.oxenUpstream}/api/repos/${encodeURIComponent(physicalNs)}/${encodeURIComponent(physicalRepo)}`,
              { method: 'DELETE' },
            )
            if (!delRes.ok && delRes.status !== 404) {
              return c.json(
                {
                  error: `Failed to delete repository ${ns}/${physicalRepo} (${delRes.status})`,
                },
                502,
              )
            }
            const displayRepo =
              (await readRepositoryById(physicalRepo))?.name ?? physicalRepo
            deletedRepos.push(displayRepo)
            await auditMutation(c, session, 'session', {
              action: 'repo.delete',
              change: requireAuditChange(
                repoSnapshot(deletedRecords.get(physicalRepo) ?? null) ?? {
                  id: physicalRepo,
                  namespace: ns,
                  name: displayRepo,
                  description: null,
                },
                null,
              ),
              namespace: ns,
              repo: displayRepo,
              message: `Deleted repository ${ns}/${displayRepo} (namespace deletion)`,
              detail: { cascade: 'namespace.delete', repository_id: physicalRepo },
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
          `${env.oxenUpstream}/api/repos/${encodeURIComponent(physicalNs)}`,
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
      change: requireAuditChange(nsSnapshot(settings), null),
      namespace: ns,
      message: `Deleted namespace ${ns}`,
      detail: { deletedRepos, deleteRepositories },
    })

    return c.json({ ok: true, deletedRepositories: deletedRepos })
  }))

  app.put('/auth/namespaces/:ns/members', guarded({ mutates: true, action: 'namespace.member.set', reason: true, body: 'optional' }, async ({ c, user: session, body: raw }) => {
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
    const beforeRole = principalRole(await captureBefore(() => listNamespaceMembers(ns)), body)
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
    const members = await listNamespaceMembers(ns)
    await auditMutation(c, session, 'session', {
      action: 'namespace.member.set',
      change: requireAuditChange({ role: beforeRole }, { role: principalRole(members, body) ?? body.role }),
      namespace: ns,
      message: `Set namespace member role ${body.role}`,
      detail: { target: memberTarget(body), role: body.role },
    })
    return c.json({ ok: true, members })
  }))

  app.delete('/auth/namespaces/:ns/members', guarded({ mutates: true, action: 'namespace.member.remove', reason: true, body: 'optional' }, async ({ c, user: session, body: raw }) => {
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
    const beforeRole = principalRole(await captureBefore(() => listNamespaceMembers(ns)), body)
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
    const members = await listNamespaceMembers(ns)
    await auditMutation(c, session, 'session', {
      action: 'namespace.member.remove',
      change: requireAuditChange({ role: beforeRole }, { role: principalRole(members, body) }),
      namespace: ns,
      message: 'Removed namespace member',
      detail: { target: memberTarget(body) },
    })
    return c.json({ ok: true, members })
  }))

  /** Read AuthZ repository record (description for About, etc.). Requires read. */
  app.get('/auth/namespaces/:ns/repos/:repo', guarded({}, async ({ c, user: session }) => {
    const ns = c.req.param('ns')
    const repo = c.req.param('repo')
    const read = await hasRepoPermission(session, ns, repo, 'read')
    if (!read.ok) return c.json({ error: 'Forbidden' }, 403)
    const record = await readRepository(ns, repo)
    if (!record) return c.json({ error: 'Not found' }, 404)
    return c.json({
      repository: {
        id: record.id,
        namespace: record.namespace,
        name: record.name,
        description: record.description,
      },
    })
  }))

  /**
   * Display-name rename and/or About description (oxen physical keys are stable UUIDs).
   * Body: { name?: string, description?: string } — at least one required.
   */
  app.patch(
    '/auth/namespaces/:ns/repos/:repo',
    guarded({ mutates: true, action: 'repo.settings.update', reason: true, body: 'optional' }, async ({ c, user: session, body: raw }) => {
      const ns = c.req.param('ns')
      const repo = c.req.param('repo')
      if (!(await canAdministerRepository(session, ns, repo))) {
        return c.json({ error: 'Forbidden' }, 403)
      }
      const body = raw as { name?: string; description?: string }
      const hasName = typeof body.name === 'string'
      const hasDescription = typeof body.description === 'string'
      if (!hasName && !hasDescription) {
        return c.json({ error: 'name or description required' }, 400)
      }

      let currentName = repo
      if (hasName) {
        const next = body.name!.trim()
        if (!next) return c.json({ error: 'Repository name required' }, 400)
        if (next !== repo) {
          const beforeRename = await captureBefore(() => readRepository(ns, repo))
          if (!beforeRename) return c.json({ error: 'Repository not found' }, 400)
          const result = await renameRepository(ns, repo, next)
          if (!result.ok) return c.json({ error: result.error }, 400)
          currentName = next
          const updated = await readRepository(ns, next)
          await auditMutation(c, session, 'session', {
            action: 'repo.rename',
            change: requireAuditChange(repoSnapshot(beforeRename), repoSnapshot(updated)),
            namespace: ns,
            repo: next,
            message: `Renamed repository ${ns}/${repo} → ${next}`,
            detail: { previous_name: repo, name: next, repository_id: updated?.id },
          })
        }
      }

      if (hasDescription) {
        const description = body.description!.trim()
        const before = await captureBefore(() => readRepository(ns, currentName))
        if (!before) return c.json({ error: 'Repository not found' }, 400)
        const result = await updateRepositoryDescription(ns, currentName, description)
        if (!result.ok) return c.json({ error: result.error }, 400)
        const afterDescription = await readRepository(ns, currentName)
        await auditMutation(c, session, 'session', {
          action: 'repo.settings.update',
          change: requireAuditChange(repoSnapshot(before), repoSnapshot(afterDescription)),
          namespace: ns,
          repo: currentName,
          message: `Updated description for ${ns}/${currentName}`,
          detail: {
            previous_description: before?.description ?? '',
            description,
            repository_id: before?.id,
          },
        })
      }

      const updated = await readRepository(ns, currentName)
      return c.json({
        ok: true,
        namespace: ns,
        name: currentName,
        repository: updated
          ? {
              id: updated.id,
              namespace: updated.namespace,
              name: updated.name,
              description: updated.description,
            }
          : null,
      })
    }),
  )

  app.get('/auth/namespaces/:ns/repos/:repo/settings/history', guarded({}, async ({ c, user: session }) => {
    const ns = c.req.param('ns')
    const repo = c.req.param('repo')
    if (!(await canAdministerRepository(session, ns, repo))) {
      return c.json({ error: 'Forbidden' }, 403)
    }
    const versions = await listRepositorySettingsVersions(ns, repo)
    if (!versions) return c.json({ error: 'Not found' }, 404)
    return c.json({ versions })
  }))

  /** Caller-facing capabilities for repository settings chrome + file browser (#148). */
  app.get('/auth/namespaces/:ns/repos/:repo/permissions', guarded({}, async ({ c, user: session }) => {
    const ns = c.req.param('ns')
    const repo = c.req.param('repo')
    const decided = await decideRepoViewerPermissions(session, ns, repo)
    if (!decided.ok) return c.json({ error: 'Forbidden' }, decided.status)
    return c.json({ permissions: decided.permissions })
  }))

  app.get('/auth/namespaces/:ns/repos/:repo/collaborators', guarded({}, async ({ c, user: session }) => {
    const ns = c.req.param('ns')
    const repo = c.req.param('repo')
    // Read-only visibility for anyone who can open the repo (or administer settings).
    const read = await hasRepoPermission(session, ns, repo, 'read')
    const administer = await canAdministerRepository(session, ns, repo)
    if (!read.ok && !administer) return c.json({ error: 'Forbidden' }, 403)
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

  app.put('/auth/namespaces/:ns/repos/:repo/collaborators', guarded({ mutates: true, action: 'repo.collaborator.set', reason: true, body: 'optional' }, async ({ c, user: session, body: raw }) => {
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
    const beforeRole = principalRole(await captureBefore(() => listRepoCollaborators(ns, repo)), body)
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
    const collaborators = await listRepoCollaborators(ns, repo)
    await auditMutation(c, session, 'session', {
      action: 'repo.collaborator.set',
      change: requireAuditChange({ role: beforeRole }, { role: principalRole(collaborators, body) ?? body.role }),
      namespace: ns,
      repo,
      message: `Set repository collaborator role ${body.role}`,
      detail: { target: memberTarget(body), role: body.role },
    })
    return c.json({ ok: true, collaborators })
  }))

  app.delete('/auth/namespaces/:ns/repos/:repo/collaborators', guarded({ mutates: true, action: 'repo.collaborator.remove', reason: true, body: 'optional' }, async ({ c, user: session, body: raw }) => {
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
    const beforeRole = principalRole(await captureBefore(() => listRepoCollaborators(ns, repo)), body)
    if (kind === 'group') {
      if (!body.group) return c.json({ error: 'group required' }, 400)
      await removeRepoGroupCollaborator(ns, repo, body.group)
    } else {
      if (!body.sub || !body.iss) {
        return c.json({ error: 'sub and iss required' }, 400)
      }
      await removeRepoCollaborator(ns, repo, { sub: body.sub, iss: body.iss })
    }
    const collaborators = await listRepoCollaborators(ns, repo)
    await auditMutation(c, session, 'session', {
      action: 'repo.collaborator.remove',
      change: requireAuditChange({ role: beforeRole }, { role: principalRole(collaborators, body) }),
      namespace: ns,
      repo,
      message: 'Removed repository collaborator',
      detail: { target: memberTarget(body) },
    })
    return c.json({ ok: true, collaborators })
  }))

  for (const base of ['/auth/namespaces/:ns/approvers', '/auth/namespaces/:ns/repos/:repo/approvers']) {
    const scopeOf = (c: { req: { param(k: string): string | undefined } }) => {
      const repo = c.req.param('repo')
      return { ns: c.req.param('ns') as string, ...(repo ? { repo } : {}) }
    }

    app.get(base, guarded({}, async ({ c, user: session }) => {
      const scope = scopeOf(c)
      if (scope.repo) {
        const read = await hasRepoPermission(session, scope.ns, scope.repo, 'read')
        const administer = await canAdministerRepository(session, scope.ns, scope.repo)
        if (!read.ok && !administer) {
          const nsView = await decideNamespaceAction(session, scope.ns, 'namespace.view')
          const denied = denialResponse(c, nsView)
          if (denied) return denied
        }
      } else {
        const denied = denialResponse(c, await decideNamespaceAction(session, scope.ns, 'namespace.view'))
        if (denied) return denied
      }
      return c.json({ approvers: await listApprovers(scope) })
    }))

    app.get(`${base}/history`, guarded({}, async ({ c, user: session }) => {
      const scope = scopeOf(c)
      const denied = denialResponse(c, await decideManageApprovers(session, scope.ns))
      if (denied) return denied
      const versions = await listApproverHistory(scope)
      if (!versions) return c.json({ error: 'Not found' }, 404)
      return c.json({ versions })
    }))

    app.put(base, guarded({ mutates: true, action: 'approver.grant', reason: true, body: 'optional' }, async ({ c, user: session, body: raw }) => {
      const scope = scopeOf(c)
      const denied = denialResponse(c, await decideManageApprovers(session, scope.ns))
      if (denied) return denied
      const body = raw as ApproverTargetBody
      const beforeSeat = principalSeat(await captureBefore(() => listApprovers(scope)), body)
      const result = await mutateApproverSeat({ op: 'grant', scope, body })
      if (!result.ok) return c.json({ error: result.error }, result.status)
      await auditMutation(c, session, 'session', {
        action: 'approver.grant',
        change: requireAuditChange(
          { approver: beforeSeat ? 'seat' : null },
          { approver: principalSeat(result.approvers, body) ? 'seat' : null },
        ),
        namespace: scope.ns,
        ...(scope.repo ? { repo: scope.repo } : {}),
        message: 'Assigned approver role',
        detail: { target: memberTarget(body) },
      })
      return c.json({ ok: true, approvers: result.approvers })
    }))

    app.delete(base, guarded({ mutates: true, action: 'approver.revoke', reason: true, body: 'optional' }, async ({ c, user: session, body: raw }) => {
      const scope = scopeOf(c)
      const denied = denialResponse(c, await decideManageApprovers(session, scope.ns))
      if (denied) return denied
      const body = raw as ApproverTargetBody
      const beforeSeat = principalSeat(await captureBefore(() => listApprovers(scope)), body)
      const result = await mutateApproverSeat({ op: 'revoke', scope, body })
      if (!result.ok) return c.json({ error: result.error }, result.status)
      await auditMutation(c, session, 'session', {
        action: 'approver.revoke',
        change: requireAuditChange(
          { approver: beforeSeat ? 'seat' : null },
          { approver: principalSeat(result.approvers, body) ? 'seat' : null },
        ),
        namespace: scope.ns,
        ...(scope.repo ? { repo: scope.repo } : {}),
        message: 'Removed approver role',
        detail: { target: memberTarget(body) },
      })
      return c.json({ ok: true, approvers: result.approvers })
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

  app.get('/auth/namespaces/:ns/custom-roles/history', guarded({}, async ({ c, user: session }) => {
    const ns = c.req.param('ns')
    const denied = denialResponse(c, await decideNamespaceAction(session, ns, 'namespace.roles.manage'))
    if (denied) return denied
    const versions = await listCustomRoleVersions(ns)
    if (!versions) return c.json({ error: 'Not found' }, 404)
    return c.json({ versions })
  }))

  app.post('/auth/namespaces/:ns/custom-roles/namespace', guarded({ mutates: true, action: 'custom-role.namespace.create', reason: true, body: 'optional' }, async ({ c, user: session, body: raw }) => {
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
      change: requireAuditChange(null, { ...result.role }),
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

  app.patch('/auth/namespaces/:ns/custom-roles/namespace/:roleId', guarded({ mutates: true, action: 'custom-role.namespace.update', reason: true, body: 'optional' }, async ({ c, user: session, body: raw }) => {
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
    const beforeRole = await captureBefore(() => getCustomNamespaceRole(ns, roleId))
    if (!beforeRole) return c.json({ error: 'Not found' }, 404)
    const result = await updateCustomNamespaceRole(ns, roleId, body)
    if (!result.ok) return c.json({ error: result.error }, 400)
    await auditMutation(c, session, 'session', {
      action: 'custom-role.namespace.update',
      change: requireAuditChange({ ...beforeRole }, { ...result.role }),
      namespace: ns,
      message: `Updated namespace role ${roleId}`,
      detail: { roleId, changes: body },
    })
    return c.json({ ok: true, role: result.role })
  }))

  app.delete('/auth/namespaces/:ns/custom-roles/namespace/:roleId', guarded({ mutates: true, action: 'custom-role.namespace.delete', reason: true, body: 'optional' }, async ({ c, user: session, body: raw }) => {
    const ns = c.req.param('ns')
    const roleId = c.req.param('roleId')
    const denied = denialResponse(c, await decideNamespaceAction(session, ns, 'namespace.roles.manage'))
    if (denied) return denied
    const beforeRole = await captureBefore(() => getCustomNamespaceRole(ns, roleId))
    if (!beforeRole) return c.json({ error: 'Not found' }, 404)
    const result = await deleteCustomNamespaceRole(
      ns,
      roleId,
      await isCustomNamespaceRoleAssigned(ns, roleId),
    )
    if (!result.ok) return c.json({ error: result.error }, 400)
    await auditMutation(c, session, 'session', {
      action: 'custom-role.namespace.delete',
      change: requireAuditChange({ ...beforeRole }, null),
      namespace: ns,
      message: `Deleted namespace role ${roleId}`,
      detail: { roleId },
    })
    return c.json({ ok: true })
  }))

  app.post('/auth/namespaces/:ns/custom-roles/repo', guarded({ mutates: true, action: 'custom-role.repo.create', reason: true, body: 'optional' }, async ({ c, user: session, body: raw }) => {
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
      change: requireAuditChange(null, { ...result.role }),
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

  app.patch('/auth/namespaces/:ns/custom-roles/repo/:roleId', guarded({ mutates: true, action: 'custom-role.repo.update', reason: true, body: 'optional' }, async ({ c, user: session, body: raw }) => {
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
    const beforeRole = await captureBefore(() => getCustomRepoRole(ns, roleId))
    if (!beforeRole) return c.json({ error: 'Not found' }, 404)
    const result = await updateCustomRepoRole(ns, roleId, body)
    if (!result.ok) return c.json({ error: result.error }, 400)
    await auditMutation(c, session, 'session', {
      action: 'custom-role.repo.update',
      change: requireAuditChange({ ...beforeRole }, { ...result.role }),
      namespace: ns,
      message: `Updated repository role ${roleId}`,
      detail: { roleId, changes: body },
    })
    return c.json({ ok: true, role: result.role })
  }))

  app.delete('/auth/namespaces/:ns/custom-roles/repo/:roleId', guarded({ mutates: true, action: 'custom-role.repo.delete', reason: true, body: 'optional' }, async ({ c, user: session }) => {
    const ns = c.req.param('ns')
    const roleId = c.req.param('roleId')
    const denied = denialResponse(c, await decideNamespaceAction(session, ns, 'namespace.roles.manage'))
    if (denied) return denied
    const beforeRole = await captureBefore(() => getCustomRepoRole(ns, roleId))
    if (!beforeRole) return c.json({ error: 'Not found' }, 404)
    const result = await deleteCustomRepoRole(
      ns,
      roleId,
      await isCustomRepoRoleAssigned(ns, roleId),
    )
    if (!result.ok) return c.json({ error: result.error }, 400)
    await auditMutation(c, session, 'session', {
      action: 'custom-role.repo.delete',
      change: requireAuditChange({ ...beforeRole }, null),
      namespace: ns,
      message: `Deleted repository role ${roleId}`,
      detail: { roleId },
    })
    return c.json({ ok: true })
  }))
}
