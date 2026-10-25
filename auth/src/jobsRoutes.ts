import type { Hono } from 'hono'
import { authorizeRepoAction } from './authz.js'
import { filterAsync } from './asyncArray.js'
import {
  cancelJob,
  completeCliJob,
  getJobPublic,
  listJobsPublic,
  parseSubmitBody,
  publicJob,
  publishSyncedCliJobs,
  readJobLogs,
  submitJob,
  type CliJobPublishBody,
  type JobCompleteBody,
} from './jobs.js'
import { getJob } from './jobsStore.js'
import { favoriteUserKey, listFavorites } from './favoritesStore.js'
import { guarded } from './routeGuard.js'

export function registerJobRoutes(app: Hono) {
  app.post('/auth/jobs', guarded({ allowScoped: true, body: 'json', invalidBody: 'Invalid JSON' }, async ({ c, user, via, body, deny }) => {
    const parsed = parseSubmitBody(body)
    if ('error' in parsed) return c.json({ error: parsed.error }, 400)

    const denied = deny(await authorizeRepoAction(user, parsed.namespace, parsed.repo, 'job.submit'))
    if (denied) return denied

    try {
      const job = await submitJob(user, via, parsed)
      return c.json({ job: publicJob(job) }, 201)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'submit failed'
      return c.json({ error: msg }, 400)
    }
  }))

  app.get('/auth/jobs', guarded({ allowScoped: true }, async ({ c, user, deny }) => {
    const namespace = c.req.query('namespace') || ''
    const repo = c.req.query('repo') || ''
    // Repo-scoped list requires both; omit both for a cross-repo list (ACL filtered).
    if ((namespace && !repo) || (!namespace && repo)) {
      return c.json(
        { error: 'namespace and repo must both be set, or both omitted' },
        400,
      )
    }
    if (namespace && repo) {
      const denied = deny(await authorizeRepoAction(user, namespace, repo, 'job.read'))
      if (denied) return denied
    }
    const limitRaw = c.req.query('limit')
    const limit = limitRaw ? Number(limitRaw) : undefined
    const status = c.req.query('status') as
      | 'queued'
      | 'running'
      | 'succeeded'
      | 'failed'
      | 'cancelled'
      | undefined
    // Over-fetch then ACL-filter when listing globally.
    const fetchLimit =
      !namespace && !repo
        ? Math.min(500, Math.max(100, (limit ?? 50) * 5))
        : limit
    const { jobs: raw, nextCursor: rawCursor } = await listJobsPublic({
      namespace: namespace || undefined,
      repo: repo || undefined,
      status,
      pin_commit: c.req.query('pin_commit') || undefined,
      cursor: c.req.query('cursor') || undefined,
      limit: Number.isFinite(fetchLimit) ? fetchLimit : undefined,
    })
    const jobs =
      namespace && repo
        ? raw
        : await filterAsync(
            raw,
            async (j) => (await authorizeRepoAction(user, j.namespace, j.repo, 'job.read')).allow,
          )
    const pageLimit = Math.min(Math.max(1, limit ?? 50), 100)
    let page = jobs.slice(0, pageLimit)
    if (c.req.query('favorites') === 'first' && !c.req.query('cursor')) {
      // Pin the caller's favorite jobs even when they fall outside the newest window.
      const candidates = (
        await Promise.all(
          (await listFavorites(favoriteUserKey(user)))
            .filter((f) => f.type === 'job')
            .map((f) => getJobPublic(f.id)),
        )
      )
        .filter((j): j is NonNullable<typeof j> =>
          !!j &&
          (!namespace || (j.namespace === namespace && j.repo === repo)) &&
          (!status || j.status === status))
      const pinned = await filterAsync(
        candidates,
        async (j) => (await authorizeRepoAction(user, j.namespace, j.repo, 'job.read')).allow,
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
    return c.json({ jobs: page, nextCursor })
  }))

  app.get('/auth/jobs/:id', guarded({ allowScoped: true }, async ({ c, user, deny }) => {
    const job = await getJobPublic(c.req.param('id'))
    if (!job) return c.json({ error: 'Not found' }, 404)
    const denied = deny(await authorizeRepoAction(user, job.namespace, job.repo, 'job.read'))
    if (denied) return denied
    return c.json({ job })
  }))

  app.get('/auth/jobs/:id/logs', guarded({ allowScoped: true }, async ({ c, user, deny }) => {
    const job = await getJob(c.req.param('id'))
    if (!job) return c.json({ error: 'Not found' }, 404)
    const denied = deny(await authorizeRepoAction(user, job.namespace, job.repo, 'job.read'))
    if (denied) return denied
    const text = await readJobLogs(job.id) ?? ''
    return c.text(text)
  }))

  app.post('/auth/jobs/:id/cancel', guarded({ allowScoped: true }, async ({ c, user, via, deny }) => {
    const existing = await getJob(c.req.param('id'))
    if (!existing) return c.json({ error: 'Not found' }, 404)
    const denied = deny(await authorizeRepoAction(user, existing.namespace, existing.repo, 'job.cancel'))
    if (denied) return denied
    const result = await cancelJob(user, via, existing.id)
    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 404 | 409)
    }
    return c.json({ job: publicJob(result.job) })
  }))

  app.post('/auth/jobs/:id/complete', guarded({ allowScoped: true }, async ({ c, user, via, deny, readBody }) => {
    const existing = await getJob(c.req.param('id'))
    if (!existing) return c.json({ error: 'Not found' }, 404)
    const denied = deny(await authorizeRepoAction(user, existing.namespace, existing.repo, 'job.complete'))
    if (denied) return denied
    const read = await readBody('json', 'Invalid JSON')
    if (!read.ok) return read.res
    const b = (read.body && typeof read.body === 'object' ? read.body : {}) as Record<
      string,
      unknown
    >
    const status = b.status
    if (
      status !== 'succeeded' &&
      status !== 'failed' &&
      status !== 'cancelled'
    ) {
      return c.json({ error: 'status must be succeeded|failed|cancelled' }, 400)
    }
    const completeBody: JobCompleteBody = {
      status,
      exit_code: typeof b.exit_code === 'number' ? b.exit_code : null,
      error: typeof b.error === 'string' ? b.error : null,
      result_commit:
        typeof b.result_commit === 'string' ? b.result_commit : null,
      result_branch:
        typeof b.result_branch === 'string' ? b.result_branch : null,
      image_digest:
        typeof b.image_digest === 'string' ? b.image_digest : null,
      log_text: typeof b.log_text === 'string' ? b.log_text : undefined,
      inputs: Array.isArray(b.inputs)
        ? b.inputs.filter(
            (x): x is { path: string; hash: string } =>
              !!x &&
              typeof x === 'object' &&
              typeof (x as { path?: unknown }).path === 'string' &&
              typeof (x as { hash?: unknown }).hash === 'string',
          )
        : undefined,
      outputs: Array.isArray(b.outputs)
        ? b.outputs.filter(
            (x): x is { path: string; hash: string } =>
              !!x &&
              typeof x === 'object' &&
              typeof (x as { path?: unknown }).path === 'string' &&
              typeof (x as { hash?: unknown }).hash === 'string',
          )
        : undefined,
    }
    const result = await completeCliJob(
      user,
      via,
      existing.id,
      completeBody,
    )
    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 404 | 409)
    }
    return c.json({ job: publicJob(result.job) })
  }))

  const publish = guarded({ allowScoped: true, body: 'json', invalidBody: 'Invalid JSON' }, async ({ c, user, via, body, deny }) => {
    const b = (body && typeof body === 'object' ? body : {}) as Record<
      string,
      unknown
    >
    const pushBranch =
      (typeof b.push_branch === 'string' && b.push_branch.trim()) ||
      (typeof b.sync_branch === 'string' && b.sync_branch.trim()) ||
      ''
    if (!pushBranch) {
      return c.json({ error: 'push_branch is required' }, 400)
    }

    // Preferred: publish local CLI job snapshots after push.
    if (Array.isArray(b.jobs) && b.jobs.length) {
      const payloads: CliJobPublishBody[] = []
      for (const raw of b.jobs) {
        if (!raw || typeof raw !== 'object') {
          return c.json({ error: 'invalid job payload' }, 400)
        }
        const j = raw as Record<string, unknown>
        const status = j.status
        if (
          status !== 'succeeded' &&
          status !== 'failed' &&
          status !== 'cancelled'
        ) {
          return c.json({ error: 'job status must be terminal' }, 400)
        }
        const namespace = typeof j.namespace === 'string' ? j.namespace : ''
        const repo = typeof j.repo === 'string' ? j.repo : ''
        const denied = deny(await authorizeRepoAction(user, namespace, repo, 'job.complete'))
        if (denied) return denied
        const existing = await getJob(String(j.id || ''))
        if (existing) {
          const denied = deny(await authorizeRepoAction(user, existing.namespace, existing.repo, 'job.complete'))
          if (denied) return denied
        }
        payloads.push({
          id: String(j.id || ''),
          namespace,
          repo,
          name: typeof j.name === 'string' ? j.name : undefined,
          source_ref: String(j.source_ref || ''),
          pin_commit: String(j.pin_commit || ''),
          image: String(j.image || ''),
          command: Array.isArray(j.command) ? j.command.map(String) : [],
          args: Array.isArray(j.args) ? j.args.map(String) : [],
          status,
          exit_code: typeof j.exit_code === 'number' ? j.exit_code : null,
          error: typeof j.error === 'string' ? j.error : null,
          result_commit:
            typeof j.result_commit === 'string' ? j.result_commit : null,
          result_branch:
            typeof j.result_branch === 'string' ? j.result_branch : null,
          image_digest:
            typeof j.image_digest === 'string' ? j.image_digest : null,
          created_at: typeof j.created_at === 'string' ? j.created_at : undefined,
          started_at:
            typeof j.started_at === 'string' ? j.started_at : undefined,
          finished_at:
            typeof j.finished_at === 'string' ? j.finished_at : undefined,
          log_text: typeof j.log_text === 'string' ? j.log_text : undefined,
          inputs: Array.isArray(j.inputs)
            ? j.inputs.filter(
                (x): x is { path: string; hash: string } =>
                  !!x &&
                  typeof x === 'object' &&
                  typeof (x as { path?: unknown }).path === 'string' &&
                  typeof (x as { hash?: unknown }).hash === 'string',
              )
            : undefined,
          outputs: Array.isArray(j.outputs)
            ? j.outputs.filter(
                (x): x is { path: string; hash: string } =>
                  !!x &&
                  typeof x === 'object' &&
                  typeof (x as { path?: unknown }).path === 'string' &&
                  typeof (x as { hash?: unknown }).hash === 'string',
              )
            : undefined,
        })
      }
      const result = await publishSyncedCliJobs(
        user,
        via,
        payloads,
        pushBranch,
      )
      if ('error' in result) {
        return c.json(
          { error: result.error },
          result.status as 400 | 404 | 409,
        )
      }
      return c.json(result)
    }

    return c.json({ error: 'jobs required' }, 400)
  })

  app.post('/auth/jobs/publish', publish)
}
