import type { Hono } from 'hono'
import { confirmPrivilegedGroups, hasRepoPermission } from './authz.js'
import { readRepository } from './authzRepository.js'
import { guarded } from './authentication/session/routeGuard.js'
import {
  getMergeRequest,
  listMergeRequests,
  MergeRequestAlreadyOpenError,
  openMergeRequest,
  rejectMergeRequest,
  resyncMergeRequest,
} from './mergeRequestStore.js'
import { getCommitQc, markCommitsQc } from './commitQcStore.js'
import { completeSignedMerge } from './completeSignedMerge.js'
import { allocateChangeControlId, CHANGE_CONTROL_HEADER } from './changeControl.js'
import { revokeSignature } from './signatureRevoke.js'
import { signerAuthorKey } from './selfMerge.js'
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

type MergeManifestResolver = (input: {
  namespace: string
  repo: string
  sourceHead: string
  targetHead: string
}) => Promise<{ manifest: string; digest: string }>

let mergeManifestResolver: MergeManifestResolver | null = null

type MergeRangeResolver = (input: {
  mr: {
    namespace: string
    repo: string
    sourceBranch: string
    targetBranch: string
  }
  sourceHead: string
  targetHead: string
}) => Promise<{ authors: string[]; commitIds: string[] }>

type LiveHeadsResolver = (mr: {
  namespace: string
  repo: string
  sourceBranch: string
  targetBranch: string
  expectedSourceHead: string
  expectedTargetHead: string
}) => Promise<{ sourceHead: string; targetHead: string }>

let mergeRangeResolver: MergeRangeResolver | null = null
let liveHeadsResolver: LiveHeadsResolver | null = null

/** Tests replace the oxen merge call. */
export function setMergeExecutorForTests(
  next: typeof mergeExecutor,
): void {
  mergeExecutor = next
}

/** Tests replace merge-result tree materialization with a fixed digest. */
export function setMergeManifestResolverForTests(
  next: MergeManifestResolver | null,
): void {
  mergeManifestResolver = next
}

/** Tests replace oxen merge-range author/commit resolution. */
export function setMergeRangeResolverForTests(next: MergeRangeResolver | null): void {
  mergeRangeResolver = next
}

/** Tests replace oxen live branch tip resolution. */
export function setLiveHeadsResolverForTests(next: LiveHeadsResolver | null): void {
  liveHeadsResolver = next
}

async function defaultExecuteMerge(mr: {
  namespace: string
  repo: string
  sourceBranch: string
  targetBranch: string
  expectedSourceHead: string
  expectedTargetHead: string
}): Promise<{ mergeCommitId: string }> {
  // Oxen 0.67 merge/{base}..{head} accepts branch names only — raw tip SHAs
  // 404 ("Could not find branch or commit"). Live tips are still gated against
  // expectedSourceHead/expectedTargetHead + signature binding before this runs.
  const { mergeBranch } = await import('./jobsOxen.js')
  const mergeCommitId = await mergeBranch(
    mr.namespace,
    mr.repo,
    mr.targetBranch,
    mr.sourceBranch,
    { name: 'Mice', email: 'merge@mice.local' },
  )
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
        title?: string
        description?: string
      }
      if (
        !body.sourceBranch?.trim() ||
        !body.targetBranch?.trim() ||
        !body.expectedSourceHead?.trim() ||
        !body.expectedTargetHead?.trim()
      ) {
        return c.json({ error: 'sourceBranch, targetBranch, and expected heads required' }, 400)
      }
      let mr
      try {
        mr = await openMergeRequest({
          repositoryId: repo.id,
          namespace: ns,
          repo: repoName,
          sourceBranch: body.sourceBranch.trim(),
          targetBranch: body.targetBranch.trim(),
          expectedSourceHead: body.expectedSourceHead.trim(),
          expectedTargetHead: body.expectedTargetHead.trim(),
          openedBy: { iss: user.iss, sub: user.sub },
          title: typeof body.title === 'string' ? body.title : undefined,
          description: typeof body.description === 'string' ? body.description : undefined,
        })
      } catch (err) {
        if (err instanceof MergeRequestAlreadyOpenError) {
          return c.json(
            {
              error: err.message,
              code: err.code,
              mergeRequestId: err.existingId,
            },
            409,
          )
        }
        throw err
      }
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

  app.post(
    '/auth/merge-requests/:id/reject',
    guarded({ mutates: true, reason: true, body: 'optional' }, async ({ c, user, audit }) => {
      const mr = await getMergeRequest(c.req.param('id'))
      if (!mr) return c.json({ error: 'Not found' }, 404)
      if (!(await hasRepoPermission(user, mr.namespace, mr.repo, 'write')).ok) {
        return c.json({ error: 'Forbidden' }, 403)
      }
      const result = await rejectMergeRequest(mr.id)
      if (!result.ok) {
        if (result.code === 'not_found') return c.json({ error: 'Not found' }, 404)
        return c.json(
          { error: 'Merge request cannot be rejected', code: 'not_rejectable' },
          400,
        )
      }
      await audit({
        action: 'merge_request.reject',
        message: `Rejected MR ${mr.id} ${mr.sourceBranch}→${mr.targetBranch}`,
        namespace: mr.namespace,
        repo: mr.repo,
        detail: { mergeRequestId: mr.id, status: result.mergeRequest.status },
      })
      return c.json({ mergeRequest: result.mergeRequest })
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

  // GxP ticket 15 — operator records a passing restore test.
  app.post(
    '/auth/admin/restore-test/pass',
    guarded({ mutates: true, body: 'optional' }, async ({ c, user, audit }) => {
      const { isInstanceAdmin } = await import('./authzInstanceStore.js')
      if (!(await isInstanceAdmin(user))) return c.json({ error: 'Instance admin required' }, 403)
      const { recordRestoreTestPassed } = await import('./restoreTestGate.js')
      const status = await recordRestoreTestPassed({
        recordedBy: `${user.iss}|${user.sub}`,
      })
      await audit({
        action: 'system.restore_test.passed',
        message: 'Operator recorded restore test pass',
        detail: status,
      })
      return c.json({ restoreTest: status })
    }),
  )

  app.get(
    '/auth/admin/restore-test',
    guarded({}, async ({ c, user }) => {
      const { isInstanceAdmin } = await import('./authzInstanceStore.js')
      if (!(await isInstanceAdmin(user))) return c.json({ error: 'Instance admin required' }, 403)
      const { loadRestoreTestStatus } = await import('./restoreTestGate.js')
      return c.json({ restoreTest: await loadRestoreTestStatus() })
    }),
  )

  // GxP ticket 19 — report-only integrity run.
  app.post(
    '/auth/admin/integrity-check',
    guarded({ mutates: true, body: 'optional' }, async ({ c, user, audit }) => {
      const { isInstanceAdmin } = await import('./authzInstanceStore.js')
      if (!(await isInstanceAdmin(user))) return c.json({ error: 'Instance admin required' }, 403)
      const { runCrossStoreIntegrity } = await import('./crossStoreIntegrity.js')
      const report = await runCrossStoreIntegrity({ notify: async () => {} })
      await audit({
        action: 'system.integrity_check',
        message: `Integrity check ${report.runId}`,
        detail: { findings: report.findings.length },
      })
      return c.json({ report })
    }),
  )

  // GxP ticket 20 — per-repo signed-record report.
  app.get(
    '/auth/repos/:ns/:repo/signed-record-report',
    guarded({}, async ({ c, user }) => {
      const ns = c.req.param('ns')
      const repoName = c.req.param('repo')
      if (!(await hasRepoPermission(user, ns, repoName, 'read')).ok) {
        return c.json({ error: 'Forbidden' }, 403)
      }
      const { buildSignedRecordReport } = await import('./signedRecordReport.js')
      const format = c.req.query('format')
      const report = await buildSignedRecordReport(`${ns}/${repoName}`)
      if (format === 'pdf') {
        return new Response(report.pdfText, {
          status: 200,
          headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="signed-record.pdf"' },
        })
      }
      return c.json({ report })
    }),
  )

  // GxP ticket 07 — revoke signature / commits → QC Failed (linked append-only record).
  app.post(
    '/auth/signatures/:id/revoke',
    guarded({ mutates: true, body: 'optional' }, async ({ c, user, body: raw, audit }) => {
      const {
        resolveReason,
        REASON_HEADER,
      } = await import('./auditReason.js')
      const reason = resolveReason({
        actor: user,
        explicit: c.req.header(REASON_HEADER),
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
      let revoker = user
      try {
        revoker = await confirmPrivilegedGroups(user)
      } catch (err) {
        if (err && typeof err === 'object' && 'status' in err && err.status === 503) {
          return c.json({ error: 'Directory unavailable' }, 503)
        }
        throw err
      }
      const result = await revokeSignature({
        signatureId: c.req.param('id'),
        revoker: {
          iss: revoker.iss,
          sub: revoker.sub,
          name: revoker.name,
          groups: revoker.groups,
        },
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

  // GxP ticket 06 — preview merge-result content hash for the signing ceremony UI.
  app.get(
    '/auth/merge-requests/:id/signing-preview',
    guarded({}, async ({ c, user }) => {
      const mr = await getMergeRequest(c.req.param('id'))
      if (!mr) return c.json({ error: 'Not found' }, 404)
      if (!(await hasRepoPermission(user, mr.namespace, mr.repo, 'read')).ok) {
        return c.json({ error: 'Forbidden' }, 403)
      }
      const { mergeResultBinding, manifestForMergeResult } = await import(
        './authentication/signing/mergeManifest.js'
      )
      const { isValidatedBranch } = await import('./signedMergeComplete.js')
      let merge
      try {
        merge = await manifestForMergeResult(
          { namespace: mr.namespace, repo: mr.repo },
          mr.expectedSourceHead,
          mr.expectedTargetHead,
        )
      } catch (err) {
        return c.json(
          {
            error: 'Merge-result manifest unavailable',
            code: 'manifest_unavailable',
            detail: String((err as Error)?.message ?? err),
          },
          503,
        )
      }
      const manifestEntries = merge.manifest
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .map((line) => {
          const sp = line.lastIndexOf(' ')
          return {
            path: line.slice(0, sp),
            contentHash: line.slice(sp + 1),
          }
        })
      const { binding, manifest } = mergeResultBinding({
        repo: `${mr.namespace}/${mr.repo}`,
        sourceHead: mr.expectedSourceHead,
        targetHead: mr.expectedTargetHead,
        merge,
      })
      return c.json({
        mergeRequest: mr,
        meaning: 'Approved',
        content: manifest,
        hash: binding.manifestDigest,
        binding,
        manifest,
        manifestEntries,
        validatedTarget: isValidatedBranch(mr.targetBranch),
        principal: {
          iss: user.iss,
          sub: user.sub,
          name: user.name ?? `${user.iss}|${user.sub}`,
        },
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
      } = await import('./auditReason.js')
      const reason = resolveReason({
        actor: user,
        explicit: c.req.header(REASON_HEADER),
      })
      if (!reason.ok) {
        return c.json({ error: reason.rejection.detail, code: reason.rejection.code }, 400)
      }
      const body = raw as {
        signatureId?: string
      }
      const signatureId =
        (typeof body.signatureId === 'string' && body.signatureId.trim()) ||
        c.req.header('x-mice-signature-id')?.trim() ||
        ''
      if (!signatureId) {
        await audit({
          action: 'merge_request.complete_denied',
          status: 400,
          message: 'signature id required',
          detail: {
            code: 'signature_invalid',
            mergeRequestId: c.req.param('id'),
            reason: reason.value.reason,
          },
        })
        return c.json(
          {
            error: 'signature id required',
            code: 'signature_invalid',
          },
          400,
        )
      }
      let signer = user
      try {
        signer = await confirmPrivilegedGroups(user)
      } catch (err) {
        if (err && typeof err === 'object' && 'status' in err && err.status === 503) {
          return c.json({ error: 'Directory unavailable' }, 503)
        }
        throw err
      }
      // Live tips, authors, commit ids and merge-result manifest are server-derived.
      let result
      try {
        result = await completeSignedMerge({
          mergeRequestId: c.req.param('id'),
          signer: {
            iss: signer.iss,
            sub: signer.sub,
            name: signer.name,
            groups: signer.groups,
          },
          signatureId,
          ...(mergeManifestResolver ? { resolveMergeManifest: mergeManifestResolver } : {}),
          ...(liveHeadsResolver ? { resolveLiveHeads: liveHeadsResolver } : {}),
          ...(mergeRangeResolver ? { resolveMergeRange: mergeRangeResolver } : {}),
          executeMerge: mergeExecutor ?? defaultExecuteMerge,
        })
      } catch (err) {
        const detail = err instanceof Error ? err.message : 'Signed merge failed'
        await audit({
          action: 'merge_request.complete_denied',
          status: 502,
          message: detail,
          detail: { mergeRequestId: c.req.param('id'), reason: reason.value.reason },
        })
        return c.json({ error: detail, code: 'merge_failed' }, 502)
      }
      if (!result.ok) {
        await audit({
          action: 'merge_request.complete_denied',
          status: result.status,
          message: result.detail,
          detail: {
            code: result.code,
            mergeRequestId: c.req.param('id'),
            reason: reason.value.reason,
            signatureId,
            ...(result.signatureConsumed ? { signatureConsumed: true } : {}),
            ...(result.authors ? { authors: result.authors, signer: signerAuthorKey(signer) } : {}),
          },
        })
        return c.json(
          { error: result.detail, code: result.code },
          result.status as 400 | 403 | 404 | 409 | 502 | 503,
        )
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
