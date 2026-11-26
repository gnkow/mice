import type { Context } from 'hono'
import { env } from '../../shared/index.js'
import {
  decideInstanceAction,
  decideManageApprovers,
  decideNamespaceAction,
} from '../../authz/index.js'
import { denialResponse } from '../../authz/http.js'
import { createNamespaceAuthz, deleteNamespaceAuthz, listNamespaceMembershipHistory, listNamespaceSettingsHistory, listNamespacesForUser, updateNamespaceSettings } from '../../authz/index.js'
import { getNamespace } from '../../authz/index.js'
import { listNamespaceMembers, namespaceGroupBindingWarning, reconcileNamespaceGroupIds } from '../../authz/index.js'
import { readRepositoryById } from '../../authz/index.js'
import type { BasePermission } from '../../authz/types.js'
import type { SessionUser } from '../../authentication/principal.js'
import type { AuditFields } from '../../shared/index.js'
import { requireAuditChange } from '../../audit/change.js'
import { captureBefore } from '../../audit/change.js'
import { nsSnapshot, repoSnapshot } from './namespaceAuditHelpers.js'
import { json, type HttpOutcome } from './httpOutcome.js'

type AuditFn = (fields: AuditFields) => Promise<void>

export async function listNamespacesUseCase(session: SessionUser): Promise<HttpOutcome> {
  return json(200, { namespaces: await listNamespacesForUser(session) })
}

export async function createNamespaceUseCase(input: {
  c: Context
  session: SessionUser
  body: {
    name?: string
    description?: string
    basePermission?: BasePermission
    membersCanCreateRepos?: boolean
  }
  audit: AuditFn
}): Promise<HttpOutcome> {
  const denied = denialResponse(input.c, await decideInstanceAction(input.session, 'namespace.create'))
  if (denied) return { response: denied }
  const body = input.body
  if (!body.name || !body.basePermission) {
    return json(400, { error: 'name and basePermission required' })
  }
  const description = typeof body.description === 'string' ? body.description : ''
  const result = await createNamespaceAuthz(
    input.session,
    body.name,
    body.basePermission,
    body.membersCanCreateRepos ?? true,
    description,
  )
  if (!result.ok) return json(400, { error: result.error })
  const name = body.name.trim()
  const created = await getNamespace(name)
  await input.audit({
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
  return json(200, {
    ok: true,
    id: result.id,
    name,
    namespace: await getNamespace(name),
  })
}

export async function getNamespaceUseCase(input: {
  c: Context
  session: SessionUser
  ns: string
}): Promise<HttpOutcome> {
  const settings = await getNamespace(input.ns)
  if (!settings) return json(404, { error: 'Not found' })
  const denied = denialResponse(input.c, await decideNamespaceAction(input.session, input.ns, 'namespace.view'))
  if (denied) return { response: denied }
  const unresolvedGroups = await reconcileNamespaceGroupIds(input.ns)
  const members = await listNamespaceMembers(input.ns)
  const groupBindingWarning = await namespaceGroupBindingWarning(input.ns)
  const [
    manageSettings,
    manageMembers,
    manageCustomRoles,
    deleteNamespace,
    manageApprovers,
  ] = await Promise.all([
    decideNamespaceAction(input.session, input.ns, 'namespace.settings'),
    decideNamespaceAction(input.session, input.ns, 'namespace.members.manage'),
    decideNamespaceAction(input.session, input.ns, 'namespace.roles.manage'),
    decideNamespaceAction(input.session, input.ns, 'namespace.delete'),
    decideManageApprovers(input.session, input.ns),
  ])
  return json(200, {
    ...settings,
    name: input.ns,
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
}

export async function namespaceSettingsHistoryUseCase(input: {
  c: Context
  session: SessionUser
  ns: string
}): Promise<HttpOutcome> {
  const denied = denialResponse(input.c, await decideNamespaceAction(input.session, input.ns, 'namespace.settings'))
  if (denied) return { response: denied }
  const versions = await listNamespaceSettingsHistory(input.ns)
  if (!versions) return json(404, { error: 'Not found' })
  return json(200, { versions })
}

export async function namespaceMembersHistoryUseCase(input: {
  c: Context
  session: SessionUser
  ns: string
}): Promise<HttpOutcome> {
  const denied = denialResponse(input.c, await decideNamespaceAction(input.session, input.ns, 'namespace.members.manage'))
  if (denied) return { response: denied }
  const versions = await listNamespaceMembershipHistory(input.ns)
  if (!versions) return json(404, { error: 'Not found' })
  return json(200, { versions })
}

export async function updateNamespaceUseCase(input: {
  c: Context
  session: SessionUser
  ns: string
  body: Partial<{
    name: string
    description: string
    basePermission: BasePermission
    membersCanCreateRepos: boolean
  }>
  audit: AuditFn
}): Promise<HttpOutcome> {
  const denied = denialResponse(input.c, await decideNamespaceAction(input.session, input.ns, 'namespace.settings'))
  if (denied) return { response: denied }
  const previous = await captureBefore(() => getNamespace(input.ns))
  if (!previous) return json(404, { error: 'Not found' })
  const nextName = input.body.name?.trim()
  const result = await updateNamespaceSettings(input.ns, input.body)
  if (!result.ok) return json(400, { error: result.error })
  const currentName = nextName || input.ns
  const updated = await getNamespace(currentName)
  await input.audit({
    action: 'namespace.settings.update',
    change: requireAuditChange(nsSnapshot(previous), nsSnapshot(updated)),
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
        name: input.body.name,
        description: input.body.description,
        basePermission: input.body.basePermission,
        membersCanCreateRepos: input.body.membersCanCreateRepos,
      },
    },
  })
  return json(200, { ok: true, id: updated?.id, name: currentName, namespace: updated })
}

export async function deleteNamespaceUseCase(input: {
  c: Context
  session: SessionUser
  ns: string
  body: Record<string, unknown>
  audit: AuditFn
}): Promise<HttpOutcome> {
  const denied = denialResponse(input.c, await decideNamespaceAction(input.session, input.ns, 'namespace.delete'))
  if (denied) return { response: denied }
  const settings = await getNamespace(input.ns)
  if (!settings) return json(404, { error: 'Not found' })
  const physicalNs = settings.id
  const deleteRepositories =
    typeof input.body.deleteRepositories === 'boolean' ? input.body.deleteRepositories : true

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
          deletedRecords.set(physicalRepo, await captureBefore(() => readRepositoryById(physicalRepo)))
          const delRes = await fetch(
            `${env.oxenUpstream}/api/repos/${encodeURIComponent(physicalNs)}/${encodeURIComponent(physicalRepo)}`,
            { method: 'DELETE' },
          )
          if (!delRes.ok && delRes.status !== 404) {
            return json(502, {
              error: `Failed to delete repository ${input.ns}/${physicalRepo} (${delRes.status})`,
            })
          }
          const displayRepo =
            (await readRepositoryById(physicalRepo))?.name ?? physicalRepo
          deletedRepos.push(displayRepo)
          await input.audit({
            action: 'repo.delete',
            change: requireAuditChange(
              repoSnapshot(deletedRecords.get(physicalRepo) ?? null) ?? {
                id: physicalRepo,
                namespace: input.ns,
                name: displayRepo,
                description: null,
              },
              null,
            ),
            namespace: input.ns,
            repo: displayRepo,
            message: `Deleted repository ${input.ns}/${displayRepo} (namespace deletion)`,
            detail: { cascade: 'namespace.delete', repository_id: physicalRepo },
          })
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'oxen error'
      return json(502, { error: `Failed to list/delete oxen repos: ${msg}` })
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
          return json(409, {
            error:
              'Namespace still has repositories on oxen-server. Pass deleteRepositories: true or delete them first.',
          })
        }
      }
    } catch {
      /* oxen unreachable — still allow AuthZ-only cleanup */
    }
  }

  const result = await deleteNamespaceAuthz(input.ns)
  if (!result.ok) return json(400, { error: result.error })

  await input.audit({
    action: 'namespace.delete',
    change: requireAuditChange(nsSnapshot(settings), null),
    namespace: input.ns,
    message: `Deleted namespace ${input.ns}`,
    detail: { deletedRepos, deleteRepositories },
  })

  return json(200, { ok: true, deletedRepositories: deletedRepos })
}
