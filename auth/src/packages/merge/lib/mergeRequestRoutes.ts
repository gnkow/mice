import type { Hono } from 'hono'
import { guarded } from '../../authentication/session.js'
import type { AuditDep } from '../../shared/index.js'
import { CHANGE_CONTROL_HEADER } from './changeControl.js'
import { isRaw } from './httpOutcome.js'
import {
  cancelMergeRequestUseCase,
  getMergeRequestUseCase,
  listMergeRequestsUseCase,
  openMergeRequestUseCase,
  rejectMergeRequestUseCase,
  reopenMergeRequestUseCase,
  resyncMergeRequestUseCase,
} from './mergeRequestLifecycle.js'
import { completeMergeRequestUseCase, signingPreviewUseCase } from './mergeComplete.js'
import { getCommitQcUseCase } from './mergeQc.js'
import {
  coveringSignatureUseCase,
  listSignaturesUseCase,
  revokeSignatureUseCase,
  revertSignatureRevocationUseCase,
  signedRecordReportUseCase,
} from './mergeSignatures.js'

export {
  setMergeExecutorForTests,
  setMergeManifestResolverForTests,
  setMergeRangeResolverForTests,
  setLiveHeadsResolverForTests,
} from './mergeRequestOxen.js'

/**
 * repositories/02 — BFF merge-request routes (open / list / get / resync).
 * Complete-with-signature lands with gxp-compliance/05.
 * Thin HTTP adapter: orchestration lives in lib use-case modules.
 */
export function registerMergeRequestRoutes(app: Hono, _deps: AuditDep): void {
  app.post(
    '/auth/repos/:ns/:repo/merge-requests',
    guarded(
      { mutates: true, action: 'merge_request.open', reason: true, body: 'optional' },
      async ({ c, user, body, audit }) => {
        const out = await openMergeRequestUseCase({
          user,
          ns: c.req.param('ns'),
          repoName: c.req.param('repo'),
          body,
          audit,
        })
        return c.json(out.body as never, out.status as never)
      },
    ),
  )

  app.get(
    '/auth/repos/:ns/:repo/merge-requests',
    guarded({}, async ({ c, user }) => {
      const out = await listMergeRequestsUseCase({
        user,
        ns: c.req.param('ns'),
        repoName: c.req.param('repo'),
      })
      return c.json(out.body as never, out.status as never)
    }),
  )

  app.get(
    '/auth/merge-requests/:id',
    guarded({}, async ({ c, user }) => {
      const out = await getMergeRequestUseCase({ user, id: c.req.param('id') })
      return c.json(out.body as never, out.status as never)
    }),
  )

  app.post(
    '/auth/merge-requests/:id/resync',
    guarded(
      { mutates: true, action: 'merge_request.resync', reason: true, body: 'optional' },
      async ({ c, user, body, audit }) => {
        const out = await resyncMergeRequestUseCase({
          user,
          id: c.req.param('id'),
          body,
          audit,
        })
        return c.json(out.body as never, out.status as never)
      },
    ),
  )

  app.post(
    '/auth/merge-requests/:id/cancel',
    guarded(
      { mutates: true, action: 'merge_request.cancel', reason: true, body: 'optional' },
      async ({ c, user, audit }) => {
        const out = await cancelMergeRequestUseCase({
          user,
          id: c.req.param('id'),
          audit,
        })
        return c.json(out.body as never, out.status as never)
      },
    ),
  )

  app.post(
    '/auth/merge-requests/:id/reopen',
    guarded(
      { mutates: true, action: 'merge_request.reopen', reason: true, body: 'optional' },
      async ({ c, user, body, audit }) => {
        const out = await reopenMergeRequestUseCase({
          user,
          id: c.req.param('id'),
          body,
          audit,
        })
        return c.json(out.body as never, out.status as never)
      },
    ),
  )

  app.post(
    '/auth/merge-requests/:id/reject',
    guarded(
      { mutates: true, action: 'merge_request.reject', reason: true, body: 'optional' },
      async ({ c, user, audit }) => {
        const out = await rejectMergeRequestUseCase({
          user,
          id: c.req.param('id'),
          audit,
        })
        return c.json(out.body as never, out.status as never)
      },
    ),
  )

  app.get(
    '/auth/repos/:ns/:repo/commits/:commitId/covering-signature',
    guarded({}, async ({ c, user }) => {
      const out = await coveringSignatureUseCase({
        user,
        ns: c.req.param('ns'),
        repoName: c.req.param('repo'),
        commitId: c.req.param('commitId'),
      })
      return c.json(out.body as never, out.status as never)
    }),
  )

  app.get(
    '/auth/repos/:ns/:repo/commits/:commitId/qc',
    guarded({}, async ({ c, user }) => {
      const out = await getCommitQcUseCase({
        user,
        ns: c.req.param('ns'),
        repoName: c.req.param('repo'),
        commitId: c.req.param('commitId'),
      })
      return c.json(out.body as never, out.status as never)
    }),
  )

  app.get(
    '/auth/repos/:ns/:repo/signed-record-report',
    guarded({}, async ({ c, user }) => {
      const out = await signedRecordReportUseCase({
        user,
        ns: c.req.param('ns'),
        repoName: c.req.param('repo'),
        format: c.req.query('format'),
      })
      if (isRaw(out)) return out.raw
      return c.json(out.body as never, out.status as never)
    }),
  )

  app.get(
    '/auth/repos/:ns/:repo/signatures',
    guarded({}, async ({ c, user }) => {
      const out = await listSignaturesUseCase({
        user,
        ns: c.req.param('ns'),
        repoName: c.req.param('repo'),
      })
      return c.json(out.body as never, out.status as never)
    }),
  )

  app.get(
    '/auth/repos/:ns/:repo/validated-branches',
    guarded({}, async ({ c, user }) => {
      const { listValidatedBranchesUseCase } = await import('./validatedBranchMark.js')
      const out = await listValidatedBranchesUseCase({
        user,
        ns: c.req.param('ns'),
        repoName: c.req.param('repo'),
      })
      return c.json(out.body as never, out.status as never)
    }),
  )

  app.post(
    '/auth/repos/:ns/:repo/validated-branches',
    guarded(
      { mutates: true, action: 'validated_branch.mark', reason: true, body: 'optional' },
      async ({ c, user, body, audit }) => {
        const { REASON_HEADER } = await import('../../audit/index.js')
        const { markBranchValidatedUseCase } = await import('./validatedBranchMark.js')
        const out = await markBranchValidatedUseCase({
          user,
          ns: c.req.param('ns'),
          repoName: c.req.param('repo'),
          body,
          reasonText: c.req.header(REASON_HEADER)?.trim() || '',
          changeControlHeader: c.req.header(CHANGE_CONTROL_HEADER),
          audit,
        })
        return c.json(out.body as never, out.status as never)
      },
    ),
  )

  app.delete(
    '/auth/repos/:ns/:repo/validated-branches/:branch',
    guarded(
      { mutates: true, action: 'validated_branch.unmark', reason: true, body: 'optional' },
      async ({ c, user, body, audit }) => {
        const { REASON_HEADER } = await import('../../audit/index.js')
        const { unmarkBranchValidatedUseCase } = await import('./validatedBranchMark.js')
        const out = await unmarkBranchValidatedUseCase({
          user,
          ns: c.req.param('ns'),
          repoName: c.req.param('repo'),
          branch: c.req.param('branch'),
          body,
          reasonText: c.req.header(REASON_HEADER)?.trim() || '',
          changeControlHeader: c.req.header(CHANGE_CONTROL_HEADER),
          audit,
        })
        return c.json(out.body as never, out.status as never)
      },
    ),
  )

  app.post(
    '/auth/signatures/:id/revoke',
    guarded(
      { mutates: true, action: 'esign.revoked', reason: true, body: 'optional' },
      async ({ c, user, body, audit }) => {
        const { REASON_HEADER } = await import('../../audit/index.js')
        const out = await revokeSignatureUseCase({
          user,
          signatureId: c.req.param('id'),
          reasonText: c.req.header(REASON_HEADER)?.trim() || '',
          changeControlHeader: c.req.header(CHANGE_CONTROL_HEADER),
          body,
          audit,
        })
        return c.json(out.body as never, out.status as never)
      },
    ),
  )

  app.post(
    '/auth/signatures/:id/revocations/:revocationId/revert',
    guarded(
      { mutates: true, action: 'esign.revocation_reverted', reason: true, body: 'optional' },
      async ({ c, user, body, audit }) => {
        const { REASON_HEADER } = await import('../../audit/index.js')
        const out = await revertSignatureRevocationUseCase({
          user,
          signatureId: c.req.param('id'),
          revocationId: c.req.param('revocationId'),
          reasonText: c.req.header(REASON_HEADER)?.trim() || '',
          changeControlHeader: c.req.header(CHANGE_CONTROL_HEADER),
          body,
          audit,
        })
        return c.json(out.body as never, out.status as never)
      },
    ),
  )

  app.get(
    '/auth/merge-requests/:id/signing-preview',
    guarded({}, async ({ c, user }) => {
      const out = await signingPreviewUseCase({ user, id: c.req.param('id') })
      return c.json(out.body as never, out.status as never)
    }),
  )

  app.post(
    '/auth/merge-requests/:id/complete',
    guarded(
      { mutates: true, action: 'merge_request.complete', body: 'optional' },
      async ({ c, user, body, audit }) => {
        const { REASON_HEADER } = await import('../../audit/index.js')
        const out = await completeMergeRequestUseCase({
          user,
          id: c.req.param('id'),
          reasonHeader: c.req.header(REASON_HEADER),
          signatureHeader: c.req.header('x-mice-signature-id'),
          body,
          audit,
        })
        return c.json(out.body as never, out.status as never)
      },
    ),
  )
}
