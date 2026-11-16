import type { Hono } from 'hono'
import { hasRepoPermission } from './authz.js'
import { readRepository } from './authzRepository.js'
import { guarded } from './authentication/session/routeGuard.js'
import {
  getMergeRequest,
  listMergeRequests,
  openMergeRequest,
  resyncMergeRequest,
} from './mergeRequestStore.js'
import { getCommitQc, markCommitsQc } from './commitQcStore.js'
import type { AuditDep } from './routeDeps.js'

/**
 * repositories/02 — BFF merge-request routes (open / list / get / resync).
 * Complete-with-signature lands with gxp-compliance/05.
 */
export function registerMergeRequestRoutes(app: Hono, _deps: AuditDep): void {
  app.post(
    '/auth/repos/:ns/:repo/merge-requests',
    guarded({ mutates: true, reason: true, body: 'optional' }, async ({ c, user, body: raw, audit }) => {
      const ns = c.req.param('ns')
      const repoName = c.req.param('repo')
      if (!(await hasRepoPermission(user, ns, repoName, 'write')).ok) {
        return c.json({ error: 'Forbidden' }, 403)
      }
      const repo = await readRepository(ns, repoName)
      if (!repo) return c.json({ error: 'Not found' }, 404)
      const body = raw as {
        sourceBranch?: string
        targetBranch?: string
        expectedSourceHead?: string
        expectedTargetHead?: string
        commitIds?: string[]
      }
      if (
        !body.sourceBranch?.trim() ||
        !body.targetBranch?.trim() ||
        !body.expectedSourceHead?.trim() ||
        !body.expectedTargetHead?.trim()
      ) {
        return c.json({ error: 'sourceBranch, targetBranch, and expected heads required' }, 400)
      }
      const mr = await openMergeRequest({
        repositoryId: repo.id,
        namespace: ns,
        repo: repoName,
        sourceBranch: body.sourceBranch.trim(),
        targetBranch: body.targetBranch.trim(),
        expectedSourceHead: body.expectedSourceHead.trim(),
        expectedTargetHead: body.expectedTargetHead.trim(),
        openedBy: { iss: user.iss, sub: user.sub },
      })
      if (Array.isArray(body.commitIds) && body.commitIds.length > 0) {
        await markCommitsQc(repo.id, body.commitIds.map(String), 'marked', {
          mergeRequestId: mr.id,
        })
      }
      await audit({
        action: 'merge_request.open',
        message: `Opened MR ${mr.id} ${body.sourceBranch}→${body.targetBranch}`,
        namespace: ns,
        repo: repoName,
        detail: { mergeRequestId: mr.id, repositoryId: repo.id },
      })
      return c.json({ mergeRequest: mr }, 201)
    }),
  )

  app.get(
    '/auth/repos/:ns/:repo/merge-requests',
    guarded({}, async ({ c, user }) => {
      const ns = c.req.param('ns')
      const repoName = c.req.param('repo')
      if (!(await hasRepoPermission(user, ns, repoName, 'read')).ok) {
        return c.json({ error: 'Forbidden' }, 403)
      }
      const repo = await readRepository(ns, repoName)
      if (!repo) return c.json({ error: 'Not found' }, 404)
      return c.json({ mergeRequests: await listMergeRequests(repo.id) })
    }),
  )

  app.get(
    '/auth/merge-requests/:id',
    guarded({}, async ({ c, user }) => {
      const mr = await getMergeRequest(c.req.param('id'))
      if (!mr) return c.json({ error: 'Not found' }, 404)
      if (!(await hasRepoPermission(user, mr.namespace, mr.repo, 'read')).ok) {
        return c.json({ error: 'Forbidden' }, 403)
      }
      return c.json({ mergeRequest: mr })
    }),
  )

  app.post(
    '/auth/merge-requests/:id/resync',
    guarded({ mutates: true, reason: true, body: 'optional' }, async ({ c, user, body: raw, audit }) => {
      const mr = await getMergeRequest(c.req.param('id'))
      if (!mr) return c.json({ error: 'Not found' }, 404)
      if (!(await hasRepoPermission(user, mr.namespace, mr.repo, 'write')).ok) {
        return c.json({ error: 'Forbidden' }, 403)
      }
      const body = raw as {
        liveSourceHead?: string
        liveTargetHead?: string
        refreshExpected?: boolean
      }
      if (!body.liveSourceHead?.trim() || !body.liveTargetHead?.trim()) {
        return c.json({ error: 'liveSourceHead and liveTargetHead required' }, 400)
      }
      const next = await resyncMergeRequest(mr.id, {
        liveSourceHead: body.liveSourceHead.trim(),
        liveTargetHead: body.liveTargetHead.trim(),
        refreshExpected: body.refreshExpected === true,
      })
      await audit({
        action: 'merge_request.resync',
        message: `Resynced MR ${mr.id} → ${next.status}`,
        namespace: mr.namespace,
        repo: mr.repo,
        detail: { mergeRequestId: mr.id, status: next.status },
      })
      return c.json({ mergeRequest: next })
    }),
  )

  app.get(
    '/auth/repos/:ns/:repo/commits/:commitId/qc',
    guarded({}, async ({ c, user }) => {
      const ns = c.req.param('ns')
      const repoName = c.req.param('repo')
      const commitId = c.req.param('commitId')
      if (!(await hasRepoPermission(user, ns, repoName, 'read')).ok) {
        return c.json({ error: 'Forbidden' }, 403)
      }
      const repo = await readRepository(ns, repoName)
      if (!repo) return c.json({ error: 'Not found' }, 404)
      return c.json({ commitId, status: await getCommitQc(repo.id, commitId) })
    }),
  )
}
