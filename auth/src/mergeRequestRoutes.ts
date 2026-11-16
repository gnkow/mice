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
import { completeSignedMerge } from './completeSignedMerge.js'
import { allocateChangeControlId, CHANGE_CONTROL_HEADER } from './changeControl.js'
import { env } from './env.js'
import { revokeSignature } from './signatureRevoke.js'
import type { AuditDep } from './routeDeps.js'

let mergeExecutor:
  | ((
      mr: {
        namespace: string
        repo: string
        sourceBranch: string
        targetBranch: string
        expectedSourceHead: string
        expectedTargetHead: string
      },
    ) => Promise<{ mergeCommitId: string }>)
  | null = null

/** Tests replace the oxen merge call. */
export function setMergeExecutorForTests(
  next: typeof mergeExecutor,
): void {
  mergeExecutor = next
}

async function defaultExecuteMerge(mr: {
  namespace: string
  repo: string
  sourceBranch: string
  targetBranch: string
}): Promise<{ mergeCommitId: string }> {
  const path = `/api/repos/${encodeURIComponent(mr.namespace)}/${encodeURIComponent(mr.repo)}/merge/${encodeURIComponent(mr.targetBranch)}..${encodeURIComponent(mr.sourceBranch)}`
  const res = await fetch(`${env.oxenUpstream}${path}`, { method: 'POST' })
  if (!res.ok) {
    throw new Error(`oxen merge failed: ${res.status}`)
  }
  const body = (await res.json().catch(() => ({}))) as { commit?: { id?: string }; id?: string }
  const mergeCommitId = body.commit?.id ?? body.id
  if (!mergeCommitId) throw new Error('oxen merge response missing commit id')
  return { mergeCommitId }
}

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

  // GxP ticket 07 — revoke signature / commits → QC Failed (linked append-only record).
  app.post(
    '/auth/signatures/:id/revoke',
    guarded({ mutates: true, body: 'optional' }, async ({ c, user, body: raw, audit }) => {
      const {
        resolveReason,
        REASON_HEADER,
        REASON_CATEGORY_HEADER,
      } = await import('./auditReason.js')
      const reason = resolveReason({
        actor: user,
        explicit: c.req.header(REASON_HEADER),
        category: c.req.header(REASON_CATEGORY_HEADER) ?? 'revocation',
        required: true,
      })
      if (!reason.ok) {
        return c.json({ error: reason.rejection.detail, code: reason.rejection.code }, 400)
      }
      const body = raw as {
        commitIds?: string[]
        mergeRequestId?: string
        changeControlId?: string
      }
      const changeControlId =
        (typeof body.changeControlId === 'string' && body.changeControlId.trim()) ||
        c.req.header(CHANGE_CONTROL_HEADER)?.trim() ||
        allocateChangeControlId()
      const result = await revokeSignature({
        signatureId: c.req.param('id'),
        revoker: { iss: user.iss, sub: user.sub, name: user.name },
        reason: reason.value.reason,
        changeControlId,
        commitIds: Array.isArray(body.commitIds) ? body.commitIds.map(String) : undefined,
        mergeRequestId: typeof body.mergeRequestId === 'string' ? body.mergeRequestId : undefined,
      })
      if (!result.ok) {
        await audit({
          action: 'esign.revoke_denied',
          status: result.status,
          message: result.detail,
          detail: { code: result.code, signatureId: c.req.param('id') },
        })
        return c.json({ error: result.detail, code: result.code }, result.status as 400 | 403 | 404)
      }
      await audit({
        action: 'esign.revoked',
        message: `Revoked signature ${result.revocation.signatureId}`,
        detail: {
          signatureId: result.revocation.signatureId,
          revocationId: result.revocation.id,
          commitIds: result.revocation.commitIds,
          blockedMergeRequestIds: result.blockedMergeRequestIds,
          changeControlId,
        },
      })
      return c.json({
        revocation: result.revocation,
        blockedMergeRequestIds: result.blockedMergeRequestIds,
      })
    }),
  )

  // GxP ticket 05 — consumable signed complete into a validated branch.
  // Uses a merge-bound signature (not the mutation-document ceremony from reason:true).
  app.post(
    '/auth/merge-requests/:id/complete',
    guarded({ mutates: true, body: 'optional' }, async ({ c, user, body: raw, audit }) => {
      const {
        resolveReason,
        REASON_HEADER,
        REASON_CATEGORY_HEADER,
      } = await import('./auditReason.js')
      const reason = resolveReason({
        actor: user,
        explicit: c.req.header(REASON_HEADER),
        category: c.req.header(REASON_CATEGORY_HEADER),
        required: true,
      })
      if (!reason.ok) {
        return c.json({ error: reason.rejection.detail, code: reason.rejection.code }, 400)
      }
      const body = raw as {
        liveSourceHead?: string
        liveTargetHead?: string
        authors?: string[]
        commitIds?: string[]
        signatureId?: string
        manifestEntries?: Array<{ path: string; contentHash: string }>
      }
      const signatureId =
        (typeof body.signatureId === 'string' && body.signatureId.trim()) ||
        c.req.header('x-mice-signature-id')?.trim() ||
        ''
      if (!body.liveSourceHead?.trim() || !body.liveTargetHead?.trim() || !signatureId) {
        return c.json(
          {
            error: 'liveSourceHead, liveTargetHead, and signature id required',
            code: 'signature_invalid',
          },
          400,
        )
      }
      const result = await completeSignedMerge({
        mergeRequestId: c.req.param('id'),
        signer: { iss: user.iss, sub: user.sub, name: user.name },
        signatureId,
        liveSourceHead: body.liveSourceHead.trim(),
        liveTargetHead: body.liveTargetHead.trim(),
        authors: Array.isArray(body.authors) ? body.authors.map(String) : [],
        commitIds: Array.isArray(body.commitIds) ? body.commitIds.map(String) : [],
        manifestEntries: body.manifestEntries,
        executeMerge: mergeExecutor ?? defaultExecuteMerge,
      })
      if (!result.ok) {
        await audit({
          action: 'merge_request.complete_denied',
          status: result.status,
          message: result.detail,
          detail: { code: result.code, mergeRequestId: c.req.param('id'), reason: reason.value.reason },
        })
        return c.json({ error: result.detail, code: result.code }, result.status as 400 | 403 | 404 | 409)
      }
      await audit({
        action: 'merge_request.complete',
        message: `Signed merge completed ${result.mergeRequest.id}`,
        namespace: result.mergeRequest.namespace,
        repo: result.mergeRequest.repo,
        detail: {
          mergeRequestId: result.mergeRequest.id,
          signatureId: result.signatureId,
          mergeCommitId: result.mergeCommitId,
          reason: reason.value.reason,
          category: reason.value.category,
        },
      })
      return c.json({
        mergeRequest: result.mergeRequest,
        mergeCommitId: result.mergeCommitId,
        signatureId: result.signatureId,
      })
    }),
  )
}
