import { hasRepoPermission } from '../../authz/index.js'
import { readRepository } from '../../authz/index.js'
import type { SessionUser } from '../../authentication/principal.js'
import { getCommitQc, listCommitQcEvents } from './commitQcStore.js'
import { json, type JsonOutcome } from './httpOutcome.js'

export async function getCommitQcUseCase(input: {
  user: SessionUser
  ns: string
  repoName: string
  commitId: string
}): Promise<JsonOutcome> {
  const { user, ns, repoName, commitId } = input
  if (!(await hasRepoPermission(user, ns, repoName, 'read')).ok) {
    return json(403, { error: 'Forbidden' })
  }
  const repo = await readRepository(ns, repoName)
  if (!repo) return json(404, { error: 'Not found' })
  return json(200, { commitId, status: await getCommitQc(repo.id, commitId) })
}

/** Current QC + append-only disposition history for a commit (ADR 0009). */
export async function getCommitDispositionUseCase(input: {
  user: SessionUser
  ns: string
  repoName: string
  commitId: string
}): Promise<JsonOutcome> {
  const { user, ns, repoName, commitId } = input
  if (!(await hasRepoPermission(user, ns, repoName, 'read')).ok) {
    return json(403, { error: 'Forbidden' })
  }
  const repo = await readRepository(ns, repoName)
  if (!repo) return json(404, { error: 'Not found' })
  const id = commitId.trim()
  if (!id) return json(400, { error: 'commitId required' })
  const status = await getCommitQc(repo.id, id)
  const events = await listCommitQcEvents(repo.id, id)
  return json(200, {
    commitId: id,
    status,
    history: events.map((e) => ({
      id: e.id,
      status: e.status,
      signatureId: e.signatureId,
      actorKey: e.actorKey,
      at: e.createdAt.toISOString(),
    })),
  })
}
