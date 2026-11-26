import { hasRepoPermission } from '../../authz/index.js'
import { readRepository } from '../../authz/index.js'
import type { SessionUser } from '../../authentication/principal.js'
import { getCommitQc } from './commitQcStore.js'
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
