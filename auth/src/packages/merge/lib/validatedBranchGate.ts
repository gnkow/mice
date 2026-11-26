import { datasetTarget } from '../../audit/index.js'
import { readRepository } from '../../authz/index.js'
import { env } from '../../shared/index.js'
import {
  branchFromMutationBody,
  branchTargetFromPath,
  branchesMovedByPublish,
  decideValidatedBranchWrite,
  isTipChangingAction,
  type ValidatedBranchWriteDecision,
} from './validatedBranchWrite.js'
import { listValidatedBranches } from './validatedBranchStore.js'

/** Mice empty-default bootstrap name (finalizeProxiedRepoCreate / ensureEmptyOxenBranch). */
export const MICE_DEFAULT_BRANCH = 'main'

export type TipGateBranchContext = {
  action: string
  pathname: string
  detailBranch?: string | null
  /** Parsed JSON body (signatureBody) when available. */
  body?: unknown
  namespace?: string
  repo?: string
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch
  oxenUpstream?: string
}

async function physicalRepoBase(
  namespace: string,
  repo: string,
  upstream: string,
): Promise<string | null> {
  const { resolvePhysicalRepo } = await import('../../namespaces/index.js')
  const physical = await resolvePhysicalRepo(namespace, repo)
  if (!physical) {
    return `${upstream}/api/repos/${encodeURIComponent(namespace)}/${encodeURIComponent(repo)}`
  }
  return `${upstream}/api/repos/${encodeURIComponent(physical.namespaceId)}/${encodeURIComponent(physical.repositoryId)}`
}

/**
 * Resolve which branch tip(s) a tip-changing action would move, including
 * commit.publish when the path has no branch (body → parent-tip match).
 */
export async function resolveTipGateBranches(
  input: TipGateBranchContext,
): Promise<string[]> {
  if (!isTipChangingAction(input.action)) return []

  const fromDetail = input.detailBranch?.trim()
  const fromPath = branchTargetFromPath(input.pathname)
  const fromBody = branchFromMutationBody(input.body)
  const named = fromDetail || fromPath || fromBody
  if (named) return [named]

  if (input.action !== 'commit.publish' && input.action !== 'commit.upload') {
    return []
  }

  const published = datasetTarget(input.pathname).publishedCommit?.trim()
  if (!published || !input.namespace || !input.repo) return []

  const upstream = (input.oxenUpstream ?? env.oxenUpstream).replace(/\/$/, '')
  const fetchImpl = input.fetchImpl ?? fetch
  const base = await physicalRepoBase(input.namespace, input.repo, upstream)
  if (!base) return []

  const tipsRes = await fetchImpl(`${base}/branches`, { headers: { Accept: 'application/json' } })
  if (!tipsRes.ok) {
    await tipsRes.body?.cancel().catch(() => undefined)
    return []
  }
  const tipsBody = (await tipsRes.json()) as {
    branches?: Array<{ name?: string; commit_id?: string }>
  }
  const branchTips = (tipsBody.branches ?? [])
    .filter((b): b is { name: string; commit_id: string } => !!b.name && !!b.commit_id)
    .map((b) => ({ name: b.name, commit_id: b.commit_id }))

  if (input.action === 'commit.upload') {
    // Transport only: without a named branch we cannot know the destination.
    return []
  }

  const commitRes = await fetchImpl(`${base}/commits/${encodeURIComponent(published)}`, {
    headers: { Accept: 'application/json' },
  })
  if (!commitRes.ok) {
    await commitRes.body?.cancel().catch(() => undefined)
    return []
  }
  const commitBody = (await commitRes.json()) as {
    commit?: { parent_ids?: string[]; parents?: string[] }
    parent_ids?: string[]
  }
  const parents =
    commitBody.commit?.parent_ids ??
    commitBody.commit?.parents ??
    commitBody.parent_ids ??
    []

  return branchesMovedByPublish({
    publishedCommit: published,
    parents: Array.isArray(parents) ? parents.filter((p): p is string => typeof p === 'string') : [],
    branchTips,
  })
}

/**
 * Load registry + resolve tips, then decide the validated-branch write gate.
 */
export async function decideProxiedValidatedBranchWrite(input: TipGateBranchContext): Promise<
  ValidatedBranchWriteDecision & { defaultBranch: string; validatedBranches: string[] }
> {
  const defaultBranch = MICE_DEFAULT_BRANCH
  let validatedBranches: string[] = [defaultBranch]
  if (input.namespace && input.repo) {
    const row = await readRepository(input.namespace, input.repo)
    if (row) {
      validatedBranches = await listValidatedBranches(row.id, defaultBranch)
    }
  }

  const branches = await resolveTipGateBranches(input)
  const decision = decideValidatedBranchWrite({
    action: input.action,
    branches,
    validatedBranches,
    defaultBranch,
  })
  return { ...decision, defaultBranch, validatedBranches }
}
