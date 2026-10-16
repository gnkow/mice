import type { Hono } from 'hono'
import { authorizeJobRead, authorizeJobSubmit, preparePrincipal } from './authz.js'
import {
  cancelJob,
  completeCliJob,
  getJobPublic,
  listJobsPublic,
  markJobsSynced,
  parseSubmitBody,
  publicJob,
  readJobLogs,
  submitJob,
  type JobCompleteBody,
} from './jobs.js'
import { getJob } from './jobsStore.js'
import { getSession, type SessionUser } from './session.js'
import { resolvePat } from './tokens.js'

async function requireAuth(c: {
  req: { header: (name: string) => string | undefined }
}): Promise<{ user: SessionUser; via: 'session' | 'pat' } | null> {
  const session = await getSession(c as never)
  if (session) {
    preparePrincipal(session)
    return { user: session, via: 'session' }
  }
  const auth = c.req.header('authorization') ?? ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : ''
  if (bearer) {
    const patUser = resolvePat(bearer)
    if (patUser) {
      preparePrincipal(patUser)
      return { user: patUser, via: 'pat' }
    }
  }
  return null
}

export function registerJobRoutes(app: Hono) {
  app.post('/auth/jobs', async (c) => {
    const authed = await requireAuth(c)
    if (!authed) return c.json({ error: 'Authentication required' }, 401)
    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400)
    }
    const parsed = parseSubmitBody(body)
    if ('error' in parsed) return c.json({ error: parsed.error }, 400)

    const gate = authorizeJobSubmit(
      authed.user,
      parsed.namespace,
      parsed.repo,
    )
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
    const authed = await requireAuth(c)
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
      const gate = authorizeJobRead(authed.user, namespace, repo)
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
            (j) => authorizeJobRead(authed.user, j.namespace, j.repo).allow,
          )
    const pageLimit = Math.min(Math.max(1, limit ?? 50), 100)
    const page = jobs.slice(0, pageLimit)
    const nextCursor =
      jobs.length > pageLimit
        ? (page[page.length - 1]?.id ?? null)
        : namespace && repo
          ? rawCursor
          : null
    return c.json({ jobs: page, nextCursor })
  })

  app.get('/auth/jobs/:id', async (c) => {
    const authed = await requireAuth(c)
    if (!authed) return c.json({ error: 'Authentication required' }, 401)
    const job = getJobPublic(c.req.param('id'))
    if (!job) return c.json({ error: 'Not found' }, 404)
    const gate = authorizeJobRead(authed.user, job.namespace, job.repo)
    if (!gate.allow) {
      return c.json({ error: gate.reason ?? 'Forbidden' }, 403)
    }
    return c.json({ job })
  })

  app.get('/auth/jobs/:id/logs', async (c) => {
    const authed = await requireAuth(c)
    if (!authed) return c.json({ error: 'Authentication required' }, 401)
    const job = getJob(c.req.param('id'))
    if (!job) return c.json({ error: 'Not found' }, 404)
    const gate = authorizeJobRead(authed.user, job.namespace, job.repo)
    if (!gate.allow) {
      return c.json({ error: gate.reason ?? 'Forbidden' }, 403)
    }
    const text = readJobLogs(job.id) ?? ''
    return c.text(text)
  })

  app.post('/auth/jobs/:id/cancel', async (c) => {
    const authed = await requireAuth(c)
    if (!authed) return c.json({ error: 'Authentication required' }, 401)
    const existing = getJob(c.req.param('id'))
    if (!existing) return c.json({ error: 'Not found' }, 404)
    const gate = authorizeJobSubmit(
      authed.user,
      existing.namespace,
      existing.repo,
    )
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
    const authed = await requireAuth(c)
    if (!authed) return c.json({ error: 'Authentication required' }, 401)
    const existing = getJob(c.req.param('id'))
    if (!existing) return c.json({ error: 'Not found' }, 404)
    const gate = authorizeJobSubmit(
      authed.user,
      existing.namespace,
      existing.repo,
    )
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

  app.post('/auth/jobs/sync', async (c) => {
    const authed = await requireAuth(c)
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
    const syncBranch =
      typeof b.sync_branch === 'string' ? b.sync_branch.trim() : ''
    const jobIds = Array.isArray(b.job_ids)
      ? b.job_ids.filter((x): x is string => typeof x === 'string' && !!x.trim())
      : []
    if (!syncBranch) return c.json({ error: 'sync_branch is required' }, 400)
    if (!jobIds.length) return c.json({ error: 'job_ids required' }, 400)

    for (const id of jobIds) {
      const existing = getJob(id)
      if (!existing) return c.json({ error: `Not found: ${id}` }, 404)
      const gate = authorizeJobSubmit(
        authed.user,
        existing.namespace,
        existing.repo,
      )
      if (!gate.allow) {
        return c.json({ error: gate.reason ?? 'Forbidden' }, 403)
      }
    }

    const result = markJobsSynced(
      authed.user,
      authed.via,
      jobIds,
      syncBranch,
    )
    if ('error' in result) {
      return c.json({ error: result.error }, result.status as 400 | 404)
    }
    return c.json(result)
  })
}
