import type { Hono } from 'hono'
import { authorizeRepoAction } from '../../authz/index.js'
import {
  cancelJob,
  completeCliJob,
  getJobPublic,
  parseCliJobPublishItem,
  parseJobCompleteBody,
  parseSubmitBody,
  publicJob,
  publishSyncedCliJobs,
  readJobLogs,
  submitJob,
  type CliJobPublishBody,
} from './jobs.js'
import { listJobsForCaller } from './jobsList.js'
import { getJob } from './jobsStore.js'
import { guarded } from '../../authentication/session.js'
import type { JobStatus } from './jobsTypes.js'

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
    const status = c.req.query('status') as JobStatus | undefined
    const listed = await listJobsForCaller({
      user,
      namespace: namespace || undefined,
      repo: repo || undefined,
      status,
      pinCommit: c.req.query('pin_commit') || undefined,
      cursor: c.req.query('cursor') || undefined,
      limit: Number.isFinite(limit) ? limit : undefined,
      favoritesFirst: c.req.query('favorites') === 'first',
    })
    return c.json(listed)
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
    const parsed = parseJobCompleteBody(read.body)
    if ('error' in parsed) return c.json({ error: parsed.error }, 400)
    const result = await completeCliJob(user, via, existing.id, parsed)
    if (!result.ok) {
      return c.json({ error: result.error }, result.status as 404 | 409)
    }
    return c.json({ job: publicJob(result.job) })
  }))

  const publish = guarded({ allowScoped: true, body: 'json', invalidBody: 'Invalid JSON' }, async ({ c, user, via, body, deny }) => {
    const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
    const pushBranch =
      (typeof b.push_branch === 'string' && b.push_branch.trim()) ||
      (typeof b.sync_branch === 'string' && b.sync_branch.trim()) ||
      ''
    if (!pushBranch) {
      return c.json({ error: 'push_branch is required' }, 400)
    }

    if (Array.isArray(b.jobs) && b.jobs.length) {
      const payloads: CliJobPublishBody[] = []
      for (const raw of b.jobs) {
        const parsed = parseCliJobPublishItem(raw)
        if ('error' in parsed) return c.json({ error: parsed.error }, 400)
        const denied = deny(await authorizeRepoAction(user, parsed.namespace, parsed.repo, 'job.complete'))
        if (denied) return denied
        const existing = await getJob(parsed.id)
        if (existing) {
          const deniedExisting = deny(
            await authorizeRepoAction(user, existing.namespace, existing.repo, 'job.complete'),
          )
          if (deniedExisting) return deniedExisting
        }
        payloads.push(parsed)
      }
      const result = await publishSyncedCliJobs(user, via, payloads, pushBranch)
      if ('error' in result) {
        return c.json({ error: result.error }, result.status as 400 | 404 | 409)
      }
      return c.json(result)
    }

    return c.json({ error: 'jobs required' }, 400)
  })

  app.post('/auth/jobs/publish', publish)
}
