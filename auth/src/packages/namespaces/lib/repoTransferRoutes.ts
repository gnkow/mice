import type { Hono } from 'hono'
import {
  acceptRepositoryTransfer,
  cancelRepositoryTransfer,
  expirePendingTransfers,
  getPendingRepositoryTransfer,
  listIncomingPendingTransfers,
  previewRepositoryTransfer,
  proposeRepositoryTransfer,
  rejectRepositoryTransfer,
  resolveNamespaceRole,
  userKey,
} from '../../authz/index.js'
import { requireAuditChange } from '../../audit/change.js'
import { guarded } from '../../authentication/session.js'
import type { AuditDep } from '../../shared/index.js'
import type { SessionUser } from '../../authentication/principal.js'

async function isNamespaceOwner(user: SessionUser, ns: string): Promise<boolean> {
  return (await resolveNamespaceRole(ns, user)) === 'owner'
}

async function auditExpired(
  auditMutation: AuditDep['audit'],
  c: { req: { raw: Request; method: string; path: string } },
  expired: Awaited<ReturnType<typeof expirePendingTransfers>>,
): Promise<void> {
  for (const row of expired) {
    await auditMutation(c as never, { sub: 'system', iss: 'mice', email: '', name: 'system' }, 'session', {
      action: 'repo.transfer.cancel',
      change: requireAuditChange({ status: 'pending' }, { status: 'expired' }),
      namespace: row.sourceNamespace,
      repo: row.repositoryName,
      message: `Expired pending transfer of ${row.sourceNamespace}/${row.repositoryName} → ${row.targetNamespace}`,
      detail: {
        expired: true,
        transfer_id: row.id,
        repository_id: row.repositoryId,
        target_namespace: row.targetNamespace,
      },
    })
  }
}

/** Repository transfer propose / accept / reject / cancel + preview + inbox. */
export function registerRepoTransferRoutes(app: Hono, { audit: auditMutation }: AuditDep): void {
  app.get(
    '/auth/namespaces/:ns/repos/:repo/transfer/preview',
    guarded({}, async ({ c, user: session }) => {
      const ns = c.req.param('ns')
      const repo = c.req.param('repo')
      const targetNamespace = (c.req.query('targetNamespace') ?? '').trim()
      if (!(await isNamespaceOwner(session, ns))) {
        // Dest Owner may preview while deciding accept (source path still applies).
        const pending = await getPendingRepositoryTransfer(ns, repo)
        if (
          !pending ||
          !(await isNamespaceOwner(session, pending.targetNamespace))
        ) {
          return c.json({ error: 'Forbidden' }, 403)
        }
      }
      const preview = await previewRepositoryTransfer(ns, repo, targetNamespace)
      if (!preview.ok) return c.json({ error: preview.error, code: preview.code }, 400)
      return c.json({
        targetNamespace: preview.targetNamespace,
        accessDiff: preview.accessDiff,
      })
    }),
  )

  app.get(
    '/auth/namespaces/:ns/repos/:repo/transfer',
    guarded({}, async ({ c, user: session }) => {
      const ns = c.req.param('ns')
      const repo = c.req.param('repo')
      const expired = await expirePendingTransfers({
        now: Date.now(),
        repositoryNs: ns,
        repositoryName: repo,
      })
      await auditExpired(auditMutation, c, expired)

      const pending = await getPendingRepositoryTransfer(ns, repo)
      if (!pending) return c.json({ transfer: null })

      const sourceOwner = await isNamespaceOwner(session, ns)
      const destOwner = await isNamespaceOwner(session, pending.targetNamespace)
      if (!sourceOwner && !destOwner) return c.json({ error: 'Forbidden' }, 403)

      const preview = await previewRepositoryTransfer(ns, repo, pending.targetNamespace)
      return c.json({
        transfer: pending,
        accessDiff: preview.ok ? preview.accessDiff : undefined,
      })
    }),
  )

  app.get(
    '/auth/namespaces/:ns/transfers/incoming',
    guarded({}, async ({ c, user: session }) => {
      const ns = c.req.param('ns')
      if (!(await isNamespaceOwner(session, ns))) return c.json({ error: 'Forbidden' }, 403)
      const expired = await expirePendingTransfers({ now: Date.now(), targetNamespace: ns })
      await auditExpired(auditMutation, c, expired)
      const transfers = await listIncomingPendingTransfers(ns)
      return c.json({ transfers })
    }),
  )

  app.post(
    '/auth/namespaces/:ns/repos/:repo/transfer',
    guarded(
      { mutates: true, action: 'repo.transfer', reason: true, body: 'optional' },
      async ({ c, user: session, body: raw }) => {
        const ns = c.req.param('ns')
        const repo = c.req.param('repo')
        if (!(await isNamespaceOwner(session, ns))) return c.json({ error: 'Forbidden' }, 403)

        const body = raw as { targetNamespace?: string }
        const targetNamespace = (body.targetNamespace ?? '').trim()
        if (!targetNamespace) return c.json({ error: 'targetNamespace required' }, 400)

        const initiatorIsDestOwner = await isNamespaceOwner(session, targetNamespace)
        const result = await proposeRepositoryTransfer({
          ns,
          name: repo,
          targetNamespace,
          proposedBy: userKey(session),
          initiatorIsDestOwner,
        })
        if (!result.ok) {
          const status = result.code === 'not_found' ? 404 : 400
          return c.json({ error: result.error, code: result.code }, status)
        }

        if (result.mode === 'one-shot') {
          await auditMutation(c, session, 'session', {
            action: 'repo.transfer',
            change: requireAuditChange({ namespace: ns }, { namespace: result.repository.namespace }),
            namespace: result.repository.namespace,
            repo: result.repository.name,
            message: `Transferred ${ns}/${repo} → ${result.repository.namespace}/${result.repository.name}`,
            detail: {
              mode: 'one-shot',
              repository_id: result.repository.id,
              previous_namespace: ns,
              target_namespace: result.repository.namespace,
              access_diff: result.accessDiff,
            },
          })
          return c.json({
            ok: true,
            mode: 'one-shot',
            repository: {
              id: result.repository.id,
              namespace: result.repository.namespace,
              name: result.repository.name,
            },
            accessDiff: result.accessDiff,
          })
        }

        await auditMutation(c, session, 'session', {
          action: 'repo.transfer',
          change: requireAuditChange(null, {
            status: 'pending',
            targetNamespace: result.transfer.targetNamespace,
          }),
          namespace: ns,
          repo,
          message: `Proposed transfer of ${ns}/${repo} → ${result.transfer.targetNamespace}`,
          detail: {
            mode: 'pending',
            transfer_id: result.transfer.id,
            repository_id: result.transfer.repositoryId,
            target_namespace: result.transfer.targetNamespace,
            access_diff: result.accessDiff,
          },
        })
        return c.json({
          ok: true,
          mode: 'pending',
          transfer: result.transfer,
          accessDiff: result.accessDiff,
        })
      },
    ),
  )

  app.post(
    '/auth/namespaces/:ns/repos/:repo/transfer/accept',
    guarded(
      { mutates: true, action: 'repo.transfer.accept', reason: true, body: 'optional' },
      async ({ c, user: session }) => {
        const ns = c.req.param('ns')
        const repo = c.req.param('repo')
        const pending = await getPendingRepositoryTransfer(ns, repo)
        if (!pending) return c.json({ error: 'No pending transfer', code: 'no_pending' }, 400)
        if (!(await isNamespaceOwner(session, pending.targetNamespace))) {
          return c.json({ error: 'Forbidden' }, 403)
        }

        const result = await acceptRepositoryTransfer({
          ns,
          name: repo,
          actorKey: userKey(session),
        })
        if (!result.ok) {
          return c.json({ error: result.error, code: result.code }, 400)
        }

        await auditMutation(c, session, 'session', {
          action: 'repo.transfer.accept',
          change: requireAuditChange({ namespace: ns }, { namespace: result.repository.namespace }),
          namespace: result.repository.namespace,
          repo: result.repository.name,
          message: `Accepted transfer of ${ns}/${repo} → ${result.repository.namespace}`,
          detail: {
            repository_id: result.repository.id,
            previous_namespace: ns,
            target_namespace: result.repository.namespace,
            access_diff: result.accessDiff,
          },
        })
        return c.json({
          ok: true,
          repository: {
            id: result.repository.id,
            namespace: result.repository.namespace,
            name: result.repository.name,
          },
          accessDiff: result.accessDiff,
        })
      },
    ),
  )

  app.post(
    '/auth/namespaces/:ns/repos/:repo/transfer/reject',
    guarded(
      {
        mutates: true,
        action: 'repo.transfer.reject',
        reason: true,
        signature: false,
        body: 'optional',
      },
      async ({ c, user: session }) => {
        const ns = c.req.param('ns')
        const repo = c.req.param('repo')
        const pending = await getPendingRepositoryTransfer(ns, repo)
        if (!pending) return c.json({ error: 'No pending transfer', code: 'no_pending' }, 400)
        if (!(await isNamespaceOwner(session, pending.targetNamespace))) {
          return c.json({ error: 'Forbidden' }, 403)
        }

        const result = await rejectRepositoryTransfer({
          ns,
          name: repo,
          actorKey: userKey(session),
        })
        if (!result.ok) return c.json({ error: result.error, code: result.code }, 400)

        await auditMutation(c, session, 'session', {
          action: 'repo.transfer.reject',
          change: requireAuditChange({ status: 'pending' }, { status: 'rejected' }),
          namespace: ns,
          repo,
          message: `Rejected transfer of ${ns}/${repo} → ${pending.targetNamespace}`,
          detail: {
            transfer_id: pending.id,
            repository_id: pending.repositoryId,
            target_namespace: pending.targetNamespace,
          },
        })
        return c.json({ ok: true, transfer: result.transfer })
      },
    ),
  )

  app.post(
    '/auth/namespaces/:ns/repos/:repo/transfer/cancel',
    guarded(
      {
        mutates: true,
        action: 'repo.transfer.cancel',
        reason: true,
        signature: false,
        body: 'optional',
      },
      async ({ c, user: session }) => {
        const ns = c.req.param('ns')
        const repo = c.req.param('repo')
        if (!(await isNamespaceOwner(session, ns))) return c.json({ error: 'Forbidden' }, 403)

        const pending = await getPendingRepositoryTransfer(ns, repo)
        if (!pending) return c.json({ error: 'No pending transfer', code: 'no_pending' }, 400)

        const result = await cancelRepositoryTransfer({
          ns,
          name: repo,
          actorKey: userKey(session),
        })
        if (!result.ok) return c.json({ error: result.error, code: result.code }, 400)

        await auditMutation(c, session, 'session', {
          action: 'repo.transfer.cancel',
          change: requireAuditChange({ status: 'pending' }, { status: 'cancelled' }),
          namespace: ns,
          repo,
          message: `Cancelled transfer of ${ns}/${repo} → ${pending.targetNamespace}`,
          detail: {
            transfer_id: pending.id,
            repository_id: pending.repositoryId,
            target_namespace: pending.targetNamespace,
          },
        })
        return c.json({ ok: true, transfer: result.transfer })
      },
    ),
  )
}
