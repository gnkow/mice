import { filterAsync } from '../../shared/index.js'
import { authorizeRepoAction } from '../../authz/index.js'
import { favoriteUserKey, listFavorites } from '../../platform/index.js'
import type { SessionUser } from '../../authentication/principal.js'
import { getJobPublic, listJobsPublic } from './jobs.js'
import type { JobRun, JobStatus } from './jobsTypes.js'

export type ListJobsRequest = {
  user: SessionUser
  /** When both set, caller already passed job.read for that repo. */
  namespace?: string
  repo?: string
  status?: JobStatus
  pinCommit?: string
  cursor?: string
  limit?: number
  favoritesFirst?: boolean
}

/**
 * List jobs for a caller: repo-scoped or cross-repo (ACL filtered), optional favorites pin.
 * Repo-scoped callers must already be authorized for `job.read`.
 */
export async function listJobsForCaller(
  req: ListJobsRequest,
): Promise<{ jobs: JobRun[]; nextCursor: string | null }> {
  const namespace = req.namespace || ''
  const repo = req.repo || ''
  const limit = req.limit
  // Over-fetch then ACL-filter when listing globally.
  const fetchLimit =
    !namespace && !repo ? Math.min(500, Math.max(100, (limit ?? 50) * 5)) : limit
  const { jobs: raw, nextCursor: rawCursor } = await listJobsPublic({
    namespace: namespace || undefined,
    repo: repo || undefined,
    status: req.status,
    pin_commit: req.pinCommit || undefined,
    cursor: req.cursor || undefined,
    limit: Number.isFinite(fetchLimit) ? fetchLimit : undefined,
  })
  const jobs =
    namespace && repo
      ? raw
      : await filterAsync(
          raw,
          async (j) => (await authorizeRepoAction(req.user, j.namespace, j.repo, 'job.read')).allow,
        )
  const pageLimit = Math.min(Math.max(1, limit ?? 50), 100)
  let page = jobs.slice(0, pageLimit)
  if (req.favoritesFirst && !req.cursor) {
    // Pin the caller's favorite jobs even when they fall outside the newest window.
    const candidates = (
      await Promise.all(
        (await listFavorites(favoriteUserKey(req.user)))
          .filter((f) => f.type === 'job')
          .map((f) => getJobPublic(f.id)),
      )
    ).filter(
      (j): j is NonNullable<typeof j> =>
        !!j &&
        (!namespace || (j.namespace === namespace && j.repo === repo)) &&
        (!req.status || j.status === req.status),
    )
    const pinned = await filterAsync(
      candidates,
      async (j) => (await authorizeRepoAction(req.user, j.namespace, j.repo, 'job.read')).allow,
    )
    const ids = new Set(pinned.map((j) => j.id))
    page = [...pinned, ...page.filter((j) => !ids.has(j.id))]
  }
  const nextCursor =
    jobs.length > pageLimit
      ? (page[page.length - 1]?.id ?? null)
      : namespace && repo
        ? rawCursor
        : null
  return { jobs: page, nextCursor }
}
