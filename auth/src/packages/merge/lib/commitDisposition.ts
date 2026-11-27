import { hasRepoPermission, readRepository } from '../../authz/index.js'
import type { SessionUser } from '../../authentication/principal.js'
import { requireAuditChange } from '../../audit/change.js'
import type { AuditFields } from '../../shared/index.js'
import {
  applyDispositionMap,
  getCommitQc,
  parseDispositionMap,
} from './commitQcStore.js'
import { getCommitAttribution } from './commitAttributionStore.js'
import { json, type JsonOutcome } from './httpOutcome.js'

type AuditFn = (fields: AuditFields) => void | Promise<void>

/**
 * Ad-hoc commit disposition (ADR 0009): write+, signed ceremony, disposition map body.
 * Approver role not required; authors may Invalid but not Valid their own commits.
 */
export async function dispositionCommitsUseCase(input: {
  user: SessionUser
  ns: string
  repoName: string
  body: Record<string, unknown>
  signatureId: string
  audit: AuditFn
}): Promise<JsonOutcome> {
  const { user, ns, repoName, audit } = input
  if (!(await hasRepoPermission(user, ns, repoName, 'write')).ok) {
    return json(403, { error: 'Forbidden' })
  }
  const repo = await readRepository(ns, repoName)
  if (!repo) return json(404, { error: 'Not found' })

  const signatureId = input.signatureId.trim()
  if (!signatureId) {
    return json(400, {
      error: 'An electronic signature is required',
      code: 'signature_required',
    })
  }

  const map = parseDispositionMap(input.body.disposition ?? input.body.dispositionMap)
  if (!map || Object.keys(map).length === 0) {
    return json(400, {
      error: 'disposition map required: { commitId: "valid"|"invalid" }',
      code: 'disposition_invalid',
    })
  }

  const authorsByCommitId: Record<string, string[]> = {}
  for (const commitId of Object.keys(map)) {
    const attr = await getCommitAttribution(commitId)
    authorsByCommitId[commitId] = attr?.author?.trim() ? [attr.author.trim()] : []
  }

  const before: Record<string, string> = {}
  for (const commitId of Object.keys(map)) {
    before[commitId] = await getCommitQc(repo.id, commitId)
  }

  const applied = await applyDispositionMap({
    repositoryId: repo.id,
    map,
    signatureId,
    actor: user,
    authorsByCommitId,
  })
  if (!applied.ok) {
    return json(applied.status, {
      error: applied.detail,
      code: applied.code,
      ...(applied.commitIds ? { commitIds: applied.commitIds } : {}),
    })
  }

  const after: Record<string, string> = {}
  for (const commitId of Object.keys(map)) {
    after[commitId] = await getCommitQc(repo.id, commitId)
  }

  await audit({
    action: 'commit.disposition',
    change: requireAuditChange({ disposition: before }, { disposition: after }),
    namespace: ns,
    repo: repoName,
    message: `Dispositioned ${applied.commitIds.length} commit(s)`,
    detail: {
      repository_id: repo.id,
      signature_id: signatureId,
      disposition: map,
      commit_ids: applied.commitIds,
    },
  })

  return json(200, {
    disposition: map,
    signatureId,
    commitIds: applied.commitIds,
  })
}
