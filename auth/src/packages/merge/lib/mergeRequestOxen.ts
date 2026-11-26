import type { MergeRequestRecord } from './mergeRequestStore.js'

export type MergeExecutor = (mr: {
  namespace: string
  repo: string
  sourceBranch: string
  targetBranch: string
  expectedSourceHead: string
  expectedTargetHead: string
}) => Promise<{ mergeCommitId: string }>

export type MergeManifestResolver = (input: {
  namespace: string
  repo: string
  sourceHead: string
  targetHead: string
}) => Promise<{ manifest: string; digest: string }>

export type MergeRangeResolver = (input: {
  mr: {
    namespace: string
    repo: string
    sourceBranch: string
    targetBranch: string
  }
  sourceHead: string
  targetHead: string
}) => Promise<{ authors: string[]; commitIds: string[] }>

export type LiveHeadsResolver = (mr: {
  namespace: string
  repo: string
  sourceBranch: string
  targetBranch: string
  expectedSourceHead: string
  expectedTargetHead: string
}) => Promise<{ sourceHead: string; targetHead: string }>

let mergeExecutor: MergeExecutor | null = null
let mergeManifestResolver: MergeManifestResolver | null = null
let mergeRangeResolver: MergeRangeResolver | null = null
let liveHeadsResolver: LiveHeadsResolver | null = null

/** Tests replace the oxen merge call. */
export function setMergeExecutorForTests(next: MergeExecutor | null): void {
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

export function getMergeExecutor(): MergeExecutor | null {
  return mergeExecutor
}

export function getMergeManifestResolver(): MergeManifestResolver | null {
  return mergeManifestResolver
}

export function getMergeRangeResolver(): MergeRangeResolver | null {
  return mergeRangeResolver
}

export function getLiveHeadsResolver(): LiveHeadsResolver | null {
  return liveHeadsResolver
}

export async function liveTipsFor(
  mr: Pick<MergeRequestRecord, 'namespace' | 'repo' | 'sourceBranch' | 'targetBranch'>,
): Promise<{ sourceHead: string; targetHead: string } | null> {
  const { getBranchTip } = await import('../../jobs/index.js')
  const [sourceHead, targetHead] = await Promise.all([
    getBranchTip(mr.namespace, mr.repo, mr.sourceBranch),
    getBranchTip(mr.namespace, mr.repo, mr.targetBranch),
  ])
  if (!sourceHead || !targetHead) return null
  return { sourceHead, targetHead }
}

export async function defaultExecuteMerge(mr: {
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
  const { mergeBranch } = await import('../../jobs/index.js')
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
