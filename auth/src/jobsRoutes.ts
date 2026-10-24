import type { Hono } from 'hono'
import { authorizeRepoAction } from './authz.js'
import {
  cancelJob,
  completeCliJob,
  getJobPublic,
  listJobsPublic,
  markJobsSynced,
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
import { authenticateRequest } from './requireAuth.js'

export function registerJobRoutes(app: Hono) {
  app.post('/auth/jobs', async (c) => {
    const authed = await authenticateRequest(c, { allowScoped: true })
    if (!authed) return c.json({ error: 'Authentication required' }, 401)
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400)
    }
    const parsed = parseSubmitBody(body)
    if ('error' in parsed) return c.json({ error: parsed.error }, 400)

    const gate = authorizeRepoAction(
      authed.user,
      parsed.namespace,
      parsed.repo, 'job.submit')
    if (!gate.allow) {
      return c.json({ error: gate.reason ?? 'Forbidden' }, 403)
    }

    try {
      const job = await submitJob(authed.user, authed.via, parsed)
      return c.json({ job: publicJob(job) }, 201)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'submit failed'
      return c.json({ error: msg }, 400)
    }
  })

  app.get('/auth/jobs', async (c) => {
    const authed = await authenticateRequest(c, { allowScoped: true })
    if (!authed) return c.json({ error: 'Authentication required' }, 401)
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
      const gate = authorizeRepoAction(authed.user, namespace, repo, 'job.read')
      if (!gate.allow) {
        return c.json({ error: gate.reason ?? 'Forbidden' }, 403)
      }
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
    const { jobs: raw, nextCursor: rawCursor } = listJobsPublic({
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
        : raw.filter(
            (j) => authorizeRepoAction(authed.user, j.namespace, j.repo, 'job.read').allow,
          )
    const pageLimit = Math.min(Math.max(1, limit ?? 50), 100)
    let page = jobs.slice(0, pageLimit)
    if (c.req.query('favorites') === 'first' && !c.req.query('cursor')) {
      // Pin the caller's favorite jobs even when they fall outside the newest window.
      const pinned = listFavorites(favoriteUserKey(authed.user))
        .filter((f) => f.type === 'job')
        .map((f) => getJobPublic(f.id))
        .filter((j): j is NonNullable<typeof j> =>
          !!j &&
          (!namespace || (j.namespace === namespace && j.repo === repo)) &&
          (!status || j.status === status) &&
          authorizeRepoAction(authed.user, j.namespace, j.repo, 'job.read').allow)
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
  })

  app.get('/auth/jobs/:id', async (c) => {
    const authed = await authenticateRequest(c, { allowScoped: true })
    if (!authed) return c.json({ error: 'Authentication required' }, 401)
    const job = getJobPublic(c.req.param('id'))
    if (!job) return c.json({ error: 'Not found' }, 404)
    const gate = authorizeRepoAction(authed.user, job.namespace, job.repo, 'job.read')
    if (!gate.allow) {
      return c.json({ error: gate.reason ?? 'Forbidden' }, 403)
    }
    return c.json({ job })
  })

  app.get('/auth/jobs/:id/logs', async (c) => {
    const authed = await authenticateRequest(c, { allowScoped: true })
    if (!authed) return c.json({ error: 'Authentication required' }, 401)
    const job = getJob(c.req.param('id'))
    if (!job) return c.json({ error: 'Not found' }, 404)
    const gate = authorizeRepoAction(authed.user, job.namespace, job.repo, 'job.read')
    if (!gate.allow) {
      return c.json({ error: gate.reason ?? 'Forbidden' }, 403)
    }
    const text = readJobLogs(job.id) ?? ''
    return c.text(text)
  })

  app.post('/auth/jobs/:id/cancel', async (c) => {
    const authed = await authenticateRequest(c, { allowScoped: true })
    if (!authed) return c.json({ error: 'Authentication required' }, 401)
    const existing = getJob(c.req.param('id'))
    if (!existing) return c.json({ error: 'Not found' }, 404)
    const gate = authorizeRepoAction(
      authed.user,
      existing.namespace,
      existing.repo, 'job.cancel')
    if (!gate.allow) {
      return c.json({ error: gate.reason ?? 'Forbidden' }, 403)
    }
    const result = await cancelJob(authed.user, authed.via, existing.id)
    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 404 | 409)
    }
    return c.json({ job: publicJob(result.job) })
  })

  app.post('/auth/jobs/:id/complete', async (c) => {
    const authed = await authenticateRequest(c, { allowScoped: true })
    if (!authed) return c.json({ error: 'Authentication required' }, 401)
    const existing = getJob(c.req.param('id'))
    if (!existing) return c.json({ error: 'Not found' }, 404)
    const gate = authorizeRepoAction(
      authed.user,
      existing.namespace,
      existing.repo, 'job.complete')
    if (!gate.allow) {
      return c.json({ error: gate.reason ?? 'Forbidden' }, 403)
    }
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400)
    }
    const b = (body && typeof body === 'object' ? body : {}) as Record<
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
    const result = completeCliJob(
      authed.user,
      authed.via,
      existing.id,
      completeBody,
    )
    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 404 | 409)
    }
    return c.json({ job: publicJob(result.job) })
  })

  async function handlePublishOrSync(c: {
    req: {
      json: () => Promise<unknown>
    }
    json: (data: unknown, status?: number) => Response
  }) {
    const authed = await authenticateRequest(c as never, { allowScoped: true })
    if (!authed) return c.json({ error: 'Authentication required' }, 401)
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400)
    }
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
        const gate = authorizeRepoAction(authed.user, namespace, repo, 'job.complete')
        if (!gate.allow) {
          return c.json({ error: gate.reason ?? 'Forbidden' }, 403)
        }
        const existing = getJob(String(j.id || ''))
        if (existing) {
          const gateExisting = authorizeRepoAction(
            authed.user,
            existing.namespace,
            existing.repo, 'job.complete')
          if (!gateExisting.allow) {
            return c.json({ error: gateExisting.reason ?? 'Forbidden' }, 403)
          }
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
      const result = publishSyncedCliJobs(
        authed.user,
        authed.via,
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

    // Legacy: job ids already registered on the BFF.
    const jobIds = Array.isArray(b.job_ids)
      ? b.job_ids.filter((x): x is string => typeof x === 'string' && !!x.trim())
      : []
    if (!jobIds.length) {
      return c.json({ error: 'jobs or job_ids required' }, 400)
    }

    for (const id of jobIds) {
      const existing = getJob(id)
      if (!existing) return c.json({ error: `Not found: ${id}` }, 404)
      const gate = authorizeRepoAction(
        authed.user,
        existing.namespace,
        existing.repo, 'job.complete')
      if (!gate.allow) {
        return c.json({ error: gate.reason ?? 'Forbidden' }, 403)
      }
    }

    const result = markJobsSynced(
      authed.user,
      authed.via,
      jobIds,
      pushBranch,
    )
    if ('error' in result) {
      return c.json({ error: result.error }, result.status as 400 | 404)
    }
    return c.json(result)
  }

  app.post('/auth/jobs/publish', (c) => handlePublishOrSync(c))
  /** @deprecated prefer POST /auth/jobs/publish after mice push */
  app.post('/auth/jobs/sync', (c) => handlePublishOrSync(c))
}
