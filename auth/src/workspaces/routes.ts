import { Readable } from 'node:stream'
import type { Context, Hono } from 'hono'
import { actorFromUser, appendAudit, type AuditActor } from '../audit.js'
import {
  authorizeStoreAdmin,
  authorizeRepoAction,
} from '../authz.js'
import { authenticateRequest } from '../requireAuth.js'
import type { SessionUser } from '../session.js'
import { getCapabilities, logCapabilities } from './capabilities.js'
import {
  CheckoutStore,
  getCheckoutStore,
  setCheckoutStore,
  StoreError,
  validCommit,
  validNs,
  type StoreAuditEvent,
} from './checkout.js'
import { checkoutStatus, evictCheckout, listCheckouts, runGc, runScrub, sweepTmp } from './checkoutMaintenance.js'
import { loadWorkspacesConfig } from './config.js'
import { PathError } from './files.js'
import { LeaseError, toPublicLease, type HolderKind } from './leases.js'
import { mountSpecFor } from './mount.js'
import { httpOxenClient } from './oxenClient.js'
import { getWorkspaceService, setWorkspaceService, validWorkspaceId, WorkspaceError, WorkspaceService } from './workspaces.js'

const SYSTEM_ACTOR: AuditActor = { sub: 'system', iss: 'mice', email: 'system@mice', name: 'Mice store' }

/** Scoped PATs are accepted here; the per-repo gates cap them. */
function requireAuth(c: Context) {
  return authenticateRequest(c, { allowScoped: true })
}

function fail(c: Context, err: unknown) {
  if (err instanceof LeaseError) {
    return c.json({ error: err.message, ...(err.holder ? { holder: err.holder } : {}), ...(err.code ? { code: err.code } : {}) }, err.status as 400)
  }
  if (err instanceof WorkspaceError || err instanceof StoreError || err instanceof PathError) {
    return c.json({ error: err.message }, err.status as 400)
  }
  const status = (err as { status?: number } | undefined)?.status
  const message = err instanceof Error ? err.message : String(err)
  if (typeof status === 'number' && status >= 400 && status < 600) return c.json({ error: message }, status as 400)
  return c.json({ error: message }, 500)
}

type Auth = { user: SessionUser; via: 'session' | 'pat' }

function audit(
  a: Auth,
  c: Context,
  action: string,
  status: number,
  where: { namespace?: string; repo?: string },
  detail: Record<string, unknown>,
) {
  appendAudit({
    actor: actorFromUser(a.user),
    via: a.via,
    method: c.req.method,
    path: c.req.path,
    status,
    action,
    ...where,
    detail,
  })
}

/** Create the singletons (store + workspace service). Idempotent. */
export async function initWorkspaces(): Promise<{ store: CheckoutStore; svc: WorkspaceService }> {
  let store = getCheckoutStore()
  let svc = getWorkspaceService()
  if (store && svc) return { store, svc }
  const cfg = loadWorkspacesConfig()
  const onAudit = (e: StoreAuditEvent) => {
    appendAudit({
      actor: SYSTEM_ACTOR,
      via: 'session',
      method: 'SYSTEM',
      path: '/auth/store',
      status: 200,
      action: e.action,
      ...(e.namespace ? { namespace: e.namespace } : {}),
      ...(e.repo ? { repo: e.repo } : {}),
      detail: e.detail,
    })
  }
  store = new CheckoutStore({
    cfg,
    oxen: httpOxenClient(),
    audit: onAudit,
    refs: () => getWorkspaceService()?.referencedCheckouts() ?? [],
  })
  await store.init()
  svc = new WorkspaceService({
    store,
    cfg,
    onLeaseEvent: (e) =>
      appendAudit({
        actor: SYSTEM_ACTOR,
        via: 'session',
        method: 'SYSTEM',
        path: '/auth/workspaces',
        status: 200,
        action: e.action,
        namespace: e.namespace,
        repo: e.repo,
        detail: e.detail,
      }),
  })
  setCheckoutStore(store)
  setWorkspaceService(svc)
  await svc.init()
  return { store, svc }
}

/** Startup + timers; every step is non-fatal. */
export async function startWorkspaceBackground(): Promise<void> {
  void logCapabilities().catch((e) => console.warn('[workspaces] capability probe failed:', e))
  let ctx: { store: CheckoutStore; svc: WorkspaceService }
  try {
    ctx = await initWorkspaces()
    await sweepTmp(ctx.store)
  } catch (e) {
    console.warn('[workspaces] store init failed:', e)
    return
  }
  const { store, svc } = ctx
  const cfg = store.cfg
  const every = (sec: number, fn: () => Promise<unknown>, label: string) => {
    if (sec <= 0) return
    const t = setInterval(() => fn().catch((e) => console.warn(`[workspaces] ${label} failed:`, e)), sec * 1000)
    t.unref()
  }
  every(cfg.gcIntervalSec, () => runGc(store, { reason: 'scheduled' }), 'gc')
  every(cfg.scrubIntervalSec, () => runScrub(store, { fraction: cfg.scrubFraction }), 'scrub')
  if (cfg.prewarm) {
    // Serial and cheap: one branch-head lookup per workspace branch, build only when the head moved.
    every(
      cfg.prewarmIntervalSec,
      async () => {
        for (const t of svc.prewarmTargets()) {
          const commit = await store.oxen.resolveCommit(t.namespace, t.repo, t.branch)
          svc.noteBranchHead(t.namespace, t.repo, t.branch, commit)
          if (!(await store.isReady(t.namespace, t.repo, commit)) && !store.builds.has(`${t.namespace}/${t.repo}/${commit}`)) {
            await store.ensureCheckout(t.namespace, t.repo, commit)
          }
        }
      },
      'prewarm',
    )
  }
}

async function ctx(c: Context) {
  const { store, svc } = await initWorkspaces()
  return { store, svc, c }
}

export function registerWorkspaceRoutes(app: Hono) {
  // ── capabilities ──
  app.get('/auth/workspaces/capabilities', async (c) => {
    const a = await requireAuth(c)
    if (!a) return c.json({ error: 'Authentication required' }, 401)
    const z = authorizeStoreAdmin(a.user)
    if (!z.allow) return c.json({ error: z.reason ?? 'Forbidden' }, 403)
    return c.json(await getCapabilities({ refresh: c.req.query('refresh') === '1' || c.req.query('refresh') === 'true' }))
  })

  // ── workspaces ──
  app.post('/auth/workspaces', async (c) => {
    const a = await requireAuth(c)
    if (!a) return c.json({ error: 'Authentication required' }, 401)
    let body: Record<string, unknown>
    try {
      body = (await c.req.json()) as Record<string, unknown>
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400)
    }
    const namespace = typeof body.namespace === 'string' ? body.namespace : ''
    const repo = typeof body.repo === 'string' ? body.repo : ''
    if (!namespace || !repo) return c.json({ error: 'namespace and repo are required' }, 400)
    const z = authorizeRepoAction(a.user, namespace, repo, 'workspace.write')
    if (!z.allow) return c.json({ error: z.reason ?? 'Forbidden' }, 403)
    const src = (body.source ?? {}) as { branch?: unknown; commit?: unknown }
    let source: { branch: string } | { commit: string }
    if (typeof src.branch === 'string' && src.branch) source = { branch: src.branch }
    else if (typeof src.commit === 'string' && src.commit) source = { commit: src.commit }
    else return c.json({ error: 'source.branch or source.commit is required' }, 400)
    try {
      const { svc } = await ctx(c)
      const ws = await svc.create({
        namespace,
        repo,
        name: typeof body.name === 'string' ? body.name : undefined,
        source,
        createdBy: { email: a.user.email, sub: a.user.sub },
      })
      audit(a, c, 'workspace.create', 202, { namespace, repo }, { workspace_id: ws.id, name: ws.name, source })
      return c.json({ workspace: ws }, 202)
    } catch (err) {
      return fail(c, err)
    }
  })

  app.get('/auth/workspaces', async (c) => {
    const a = await requireAuth(c)
    if (!a) return c.json({ error: 'Authentication required' }, 401)
    const namespace = c.req.query('namespace') ?? ''
    const repo = c.req.query('repo') ?? ''
    const { svc } = await ctx(c)
    if (!namespace && !repo) {
      const all = svc.list()
      return c.json({
        workspaces: all.filter((w) => authorizeRepoAction(a.user, w.namespace, w.repo, 'workspace.read').allow),
      })
    }
    if (!namespace || !repo) return c.json({ error: 'namespace and repo are required together' }, 400)
    const z = authorizeRepoAction(a.user, namespace, repo, 'workspace.read')
    if (!z.allow) return c.json({ error: z.reason ?? 'Forbidden' }, 403)
    return c.json({ workspaces: svc.list({ namespace, repo }) })
  })

  /** Resolve :id, enforce repo-scoped authz; 404 for unknown ids and for repos the caller cannot read. */
  async function withWorkspace(c: Context, write: boolean) {
    const a = await requireAuth(c)
    if (!a) return { res: c.json({ error: 'Authentication required' }, 401) }
    const id = c.req.param('id') ?? ''
    const { svc } = await ctx(c)
    const st = validWorkspaceId(id) ? svc.getState(id) : undefined
    if (!st) return { res: c.json({ error: 'Workspace not found' }, 404) }
    const z = authorizeRepoAction(a.user, st.namespace, st.repo, write ? 'workspace.write' : 'workspace.read')
    if (!z.allow) return { res: c.json({ error: z.reason ?? 'Forbidden' }, 403) }
    return { a, svc, st }
  }

  app.get('/auth/workspaces/:id', async (c) => {
    const w = await withWorkspace(c, false)
    if ('res' in w) return w.res
    return c.json({ workspace: await w.svc.get(w.st.id) })
  })

  app.delete('/auth/workspaces/:id', async (c) => {
    const w = await withWorkspace(c, true)
    if ('res' in w) return w.res
    try {
      await w.svc.delete(w.st.id)
      audit(w.a, c, 'workspace.delete', 200, { namespace: w.st.namespace, repo: w.st.repo }, { workspace_id: w.st.id, name: w.st.name })
      return c.json({ ok: true })
    } catch (err) {
      return fail(c, err)
    }
  })

  app.post('/auth/workspaces/:id/retry', async (c) => {
    const w = await withWorkspace(c, true)
    if ('res' in w) return w.res
    try {
      return c.json({ workspace: await w.svc.retry(w.st.id) }, 202)
    } catch (err) {
      return fail(c, err)
    }
  })

  // ── leases ──
  const HOLDER_KINDS: HolderKind[] = ['job', 'session', 'user', 'api']

  app.post('/auth/workspaces/:id/leases', async (c) => {
    const w = await withWorkspace(c, false)
    if ('res' in w) return w.res
    let body: Record<string, unknown>
    try {
      body = (await c.req.json()) as Record<string, unknown>
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400)
    }
    const mode = body.mode
    if (mode !== 'read' && mode !== 'write') return c.json({ error: "mode must be 'read' or 'write'" }, 400)
    if (mode === 'write') {
      const z = authorizeRepoAction(w.a.user, w.st.namespace, w.st.repo, 'workspace.write')
      if (!z.allow) return c.json({ error: z.reason ?? 'Forbidden' }, 403)
    }
    const kind = (typeof body.holder_kind === 'string' ? body.holder_kind : 'user') as HolderKind
    if (!HOLDER_KINDS.includes(kind)) return c.json({ error: 'invalid holder_kind' }, 400)
    const label = typeof body.holder_label === 'string' ? body.holder_label.slice(0, 120) : undefined
    const holderId = typeof body.holder_id === 'string' && body.holder_id ? body.holder_id.slice(0, 120) : w.a.user.sub
    const ttl = typeof body.ttl_sec === 'number' ? body.ttl_sec : undefined
    try {
      const lease = await w.svc.acquireLease({
        workspaceId: w.st.id,
        mode,
        holder: { kind, id: holderId, ...(label ? { label } : {}) },
        ttlSec: ttl,
        ownerSub: w.a.user.sub,
        ownerEmail: w.a.user.email,
      })
      audit(w.a, c, 'workspace.lease.acquire', 201, { namespace: w.st.namespace, repo: w.st.repo }, {
        workspace_id: w.st.id, lease_id: lease.id, mode, holder: lease.holder,
      })
      return c.json({ lease: toPublicLease(lease) }, 201)
    } catch (err) {
      return fail(c, err)
    }
  })

  app.get('/auth/workspaces/:id/leases', async (c) => {
    const w = await withWorkspace(c, false)
    if ('res' in w) return w.res
    return c.json({
      leases: w.svc.leases.list(w.st.id).map(toPublicLease),
      writer: w.svc.leases.writer(w.st.id)?.holder ?? null,
    })
  })

  /** Lease owner or instance admin. */
  async function withLease(c: Context) {
    const w = await withWorkspace(c, false)
    if ('res' in w) return { res: w.res }
    const lease = w.svc.leases.get(c.req.param('leaseId') ?? '')
    if (!lease || lease.workspace_id !== w.st.id) return { res: c.json({ error: 'Lease not found' }, 404) }
    const owner = lease.owner_sub === w.a.user.sub
    const admin = !owner && authorizeStoreAdmin(w.a.user).allow
    if (!owner && !admin) return { res: c.json({ error: 'Only the lease owner or an admin can do this', holder: lease.holder }, 403) }
    return { ...w, lease, forced: !owner }
  }

  app.delete('/auth/workspaces/:id/leases/:leaseId', async (c) => {
    const w = await withLease(c)
    if ('res' in w) return w.res
    await w.svc.leases.release(w.lease.id)
    audit(w.a, c, w.forced ? 'workspace.lease.force_release' : 'workspace.lease.release', 200, { namespace: w.st.namespace, repo: w.st.repo }, {
      workspace_id: w.st.id, lease_id: w.lease.id, mode: w.lease.mode, holder: w.lease.holder,
    })
    return c.json({ ok: true })
  })

  app.post('/auth/workspaces/:id/leases/:leaseId/renew', async (c) => {
    const w = await withLease(c)
    if ('res' in w) return w.res
    let ttl: number | undefined
    try {
      const b = (await c.req.json()) as { ttl_sec?: unknown }
      if (typeof b.ttl_sec === 'number') ttl = b.ttl_sec
    } catch {
      /* body is optional */
    }
    try {
      return c.json({ lease: toPublicLease(await w.svc.leases.renew(w.lease.id, ttl)) })
    } catch (err) {
      return fail(c, err)
    }
  })

  app.post('/auth/workspaces/:id/leases/:leaseId/mount', async (c) => {
    const w = await withLease(c)
    if ('res' in w) return w.res
    let body: { mode?: unknown; dest?: unknown }
    try {
      body = (await c.req.json()) as typeof body
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400)
    }
    const mode = body.mode === 'ro' || body.mode === 'rw' ? body.mode : null
    if (!mode || typeof body.dest !== 'string') return c.json({ error: "mode ('ro'|'rw') and dest are required" }, 400)
    try {
      return c.json({ mount: await mountSpecFor(w.svc, w.st, w.lease, mode, body.dest, { user: w.a.user }) })
    } catch (err) {
      return fail(c, err)
    }
  })

  app.get('/auth/workspaces/:id/changes', async (c) => {
    const w = await withWorkspace(c, false)
    if ('res' in w) return w.res
    try {
      return c.json(await w.svc.changes(w.st.id))
    } catch (err) {
      return fail(c, err)
    }
  })

  app.get('/auth/workspaces/:id/archive', async (c) => {
    const w = await withWorkspace(c, false)
    if ('res' in w) return w.res
    try {
      const gen = await w.svc.archive(w.st.id)
      return new Response(Readable.toWeb(Readable.from(gen)) as ReadableStream, {
        headers: {
          'content-type': 'application/x-tar',
          'content-disposition': `attachment; filename="${w.st.id}.tar"`,
          'x-content-type-options': 'nosniff',
        },
      })
    } catch (err) {
      return fail(c, err)
    }
  })

  const filesHandler = async (c: Context) => {
    const w = await withWorkspace(c, false)
    if ('res' in w) return w.res
    const prefix = `/auth/workspaces/${w.st.id}/files`
    let raw = c.req.path.startsWith(prefix) ? c.req.path.slice(prefix.length) : ''
    try {
      raw = decodeURIComponent(raw)
    } catch {
      return c.json({ error: 'invalid path encoding' }, 400)
    }
    try {
      const r = await w.svc.readPath(w.st.id, raw)
      if (r.kind === 'dir') return c.json({ path: r.path, type: 'dir', entries: r.entries })
      return new Response(Readable.toWeb(r.file.stream) as ReadableStream, {
        headers: {
          'content-type': 'application/octet-stream',
          'content-length': String(r.file.size),
          'x-content-type-options': 'nosniff',
          'content-disposition': 'attachment',
          ...(r.sha256 ? { etag: `"${r.sha256}"` } : {}),
        },
      })
    } catch (err) {
      return fail(c, err)
    }
  }
  app.get('/auth/workspaces/:id/files', filesHandler)
  app.get('/auth/workspaces/:id/files/*', filesHandler)

  // ── checkouts ──
  app.get('/auth/checkouts', async (c) => {
    const a = await requireAuth(c)
    if (!a) return c.json({ error: 'Authentication required' }, 401)
    const namespace = c.req.query('namespace') ?? ''
    const repo = c.req.query('repo') ?? ''
    const z = namespace && repo ? authorizeRepoAction(a.user, namespace, repo, 'workspace.read') : authorizeStoreAdmin(a.user)
    if (!z.allow) return c.json({ error: z.reason ?? 'Forbidden' }, 403)
    const { store } = await ctx(c)
    return c.json({ checkouts: await listCheckouts(store, { namespace: namespace || undefined, repo: repo || undefined }) })
  })

  app.get('/auth/checkouts/:ns/:repo/:commit', async (c) => {
    const a = await requireAuth(c)
    if (!a) return c.json({ error: 'Authentication required' }, 401)
    const { ns, repo, commit } = c.req.param()
    if (!validNs(ns) || !validNs(repo) || !validCommit(commit)) return c.json({ error: 'invalid path' }, 400)
    const z = authorizeRepoAction(a.user, ns, repo, 'workspace.read')
    if (!z.allow) return c.json({ error: z.reason ?? 'Forbidden' }, 403)
    const { store } = await ctx(c)
    return c.json(await checkoutStatus(store, ns, repo, commit))
  })

  app.post('/auth/checkouts', async (c) => {
    const a = await requireAuth(c)
    if (!a) return c.json({ error: 'Authentication required' }, 401)
    let body: Record<string, unknown>
    try {
      body = (await c.req.json()) as Record<string, unknown>
    } catch {
      return c.json({ error: 'Invalid JSON' }, 400)
    }
    const namespace = typeof body.namespace === 'string' ? body.namespace : ''
    const repo = typeof body.repo === 'string' ? body.repo : ''
    const ref = typeof body.ref === 'string' ? body.ref : ''
    if (!namespace || !repo || !ref) return c.json({ error: 'namespace, repo and ref are required' }, 400)
    const z = authorizeRepoAction(a.user, namespace, repo, 'workspace.write')
    if (!z.allow) return c.json({ error: z.reason ?? 'Forbidden' }, 403)
    try {
      const { store } = await ctx(c)
      const { commit, done } = await store.startCheckout(namespace, repo, ref)
      done.catch(() => undefined)
      return c.json(await checkoutStatus(store, namespace, repo, commit), 202)
    } catch (err) {
      return fail(c, err)
    }
  })

  app.delete('/auth/checkouts/:ns/:repo/:commit', async (c) => {
    const a = await requireAuth(c)
    if (!a) return c.json({ error: 'Authentication required' }, 401)
    const z = authorizeStoreAdmin(a.user)
    if (!z.allow) return c.json({ error: z.reason ?? 'Forbidden' }, 403)
    const { ns, repo, commit } = c.req.param()
    if (!validNs(ns) || !validNs(repo) || !validCommit(commit)) return c.json({ error: 'invalid path' }, 400)
    const { store } = await ctx(c)
    const r = await evictCheckout(store, ns, repo, commit)
    if (r === 'referenced') return c.json({ error: 'Checkout is referenced by a workspace or running build' }, 409)
    if (r === 'missing') return c.json({ error: 'Checkout not found' }, 404)
    audit(a, c, 'checkout.evict', 200, { namespace: ns, repo }, { commit, reason: 'manual' })
    return c.json({ ok: true })
  })

  // ── store ──
  app.post('/auth/store/gc', async (c) => {
    const a = await requireAuth(c)
    if (!a) return c.json({ error: 'Authentication required' }, 401)
    const z = authorizeStoreAdmin(a.user)
    if (!z.allow) return c.json({ error: z.reason ?? 'Forbidden' }, 403)
    const { store } = await ctx(c)
    const report = await runGc(store, { reason: 'manual' })
    audit(a, c, 'store.gc', 200, {}, { ...report })
    return c.json(report)
  })

  app.post('/auth/store/scrub', async (c) => {
    const a = await requireAuth(c)
    if (!a) return c.json({ error: 'Authentication required' }, 401)
    const z = authorizeStoreAdmin(a.user)
    if (!z.allow) return c.json({ error: z.reason ?? 'Forbidden' }, 403)
    const { store } = await ctx(c)
    return c.json(await runScrub(store, { all: true }))
  })
}
