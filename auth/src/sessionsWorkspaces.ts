import { appendAudit } from './audit.js'
import { authorizeRepoAction } from './authz.js'
import type { SessionUser } from './authentication/session/session.js'
import { isWorkspaceMount } from './sessionsMounts.js'
import { getSessionRecord, listSessionsWithStatus, updateSession } from './sessionsStore.js'
import type { DesktopSession, ResolvedMountInput, SessionMount, SessionMountInput } from './sessionsTypes.js'
import { loadWorkspacesConfig } from './workspaces/config.js'
import { LeaseError, type HolderKind, type Lease } from './workspaces/leases.js'
import { mountSpecFor, verifyUpperHash } from './workspaces/mount.js'
import { getWorkspaceService, type WorkspaceService, type WorkspaceState } from './workspaces/workspaces.js'

export class SessionWorkspaceError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly holder?: unknown,
  ) {
    super(message)
    this.name = 'SessionWorkspaceError'
  }
}

/** The service singleton is created asynchronously at boot; wait briefly for it. */
export async function workspaceServiceOrThrow(waitMs = 30_000): Promise<WorkspaceService> {
  const t0 = Date.now()
  for (;;) {
    const svc = getWorkspaceService()
    if (svc) return svc
    if (Date.now() - t0 > waitMs) throw new SessionWorkspaceError('workspaces are not available', 503)
    await new Promise((r) => setTimeout(r, 200))
  }
}

export const sessionLeaseLabel = (sessionId: string): string => sessionId.slice(0, 8)

export function workspaceMountsOf(session: Pick<DesktopSession, 'mounts'>): SessionMount[] {
  return (session.mounts ?? []).filter(isWorkspaceMount)
}

/** Workspace ids a session mounts (sorted, unique) for list/get JSON. */
export function workspaceIdsOf(session: Pick<DesktopSession, 'mounts'>): string[] {
  return [...new Set(workspaceMountsOf(session).map((m) => m.workspace_id!))].sort()
}

/**
 * Create-time validation of workspace mounts: the workspace exists, is `ready`, the
 * caller may use it (ro → repo read, rw → repo write), and namespace/repo are filled
 * in from the workspace.
 */
export async function resolveWorkspaceInputs(
  user: SessionUser,
  inputs: SessionMountInput[],
): Promise<SessionMountInput[]> {
  if (!inputs.some((i) => i.workspace_id)) return inputs
  const svc = await workspaceServiceOrThrow()
  return Promise.all(inputs.map(async (i) => {
    if (!i.workspace_id) return i // new_workspace: created later
    const ws = svc.getState(i.workspace_id)
    if (!ws) throw new SessionWorkspaceError(`workspace ${i.workspace_id} not found`, 404)
    if ((i.namespace && i.namespace !== ws.namespace) || (i.repo && i.repo !== ws.repo)) {
      throw new SessionWorkspaceError(
        `workspace ${ws.id} belongs to ${ws.namespace}/${ws.repo}, not ${i.namespace}/${i.repo}`,
        400,
      )
    }
    if (ws.status !== 'ready') {
      const why = ws.status === 'error' && ws.last_error ? `: ${ws.last_error}` : ''
      throw new SessionWorkspaceError(`workspace ${ws.id} is ${ws.status}, not ready${why}`, 409)
    }
    const gate =
      i.mount_mode === 'ro'
        ? await authorizeRepoAction(user, ws.namespace, ws.repo, 'workspace.read')
        : await authorizeRepoAction(user, ws.namespace, ws.repo, 'workspace.write')
    if (!gate.allow) {
      throw new SessionWorkspaceError(
        `${gate.reason ?? 'Forbidden'} (workspace ${ws.id} in ${ws.namespace}/${ws.repo})`,
        403,
      )
    }
    return { ...i, namespace: ws.namespace, repo: ws.repo }
  }))
}

/** ro → repo read, rw → repo write, keyed on the effective mode of the lease. */
export async function authorizeWorkspaceMounts(
  user: SessionUser,
  mounts: SessionMount[],
): Promise<{ allow: boolean; reason?: string }> {
  for (const m of workspaceMountsOf({ mounts })) {
    const mode = m.effective_mode ?? m.mount_mode
    const gate =
      mode === 'ro'
        ? await authorizeRepoAction(user, m.namespace, m.repo, 'workspace.read')
        : await authorizeRepoAction(user, m.namespace, m.repo, 'workspace.write')
    if (!gate.allow) {
      return { allow: false, reason: gate.reason ?? `mount ${m.namespace}/${m.repo} requires repository access` }
    }
  }
  return { allow: true }
}

const holderText = (h: { kind: string; id: string; label?: string }) => `${h.kind} ${h.label ?? h.id}`

type Wanted = { mount: SessionMount; mode: 'read' | 'write'; degradedReason: string | null }

export type LeaseOutcome = { mounts: SessionMount[]; notices: string[] }

async function auditLease(
  session: Pick<DesktopSession, 'id' | 'owner' | 'via'>,
  action: 'workspace.lease.acquire' | 'workspace.lease.release',
  ws: Pick<WorkspaceState, 'id' | 'namespace' | 'repo'> | undefined,
  lease: Pick<Lease, 'id' | 'mode'>,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await appendAudit({
    actor: session.owner,
    via: session.via,
    method: 'SYSTEM',
    path: `/auth/sessions/${session.id}`,
    status: 200,
    action,
    ...(ws ? { namespace: ws.namespace, repo: ws.repo } : {}),
    detail: { session_id: session.id, workspace_id: ws?.id, lease_id: lease.id, mode: lease.mode, ...extra },
  })
}

/**
 * Take one lease per workspace mount, all-or-nothing in sorted workspace order. A `rw`
 * request that cannot get the write lease (held by someone else, or the workspace is
 * over quota) degrades to a read lease with a notice; the session still starts.
 * Any previous leases of this session on the same workspaces must be released first.
 */
export async function acquireSessionLeases(
  session: Pick<DesktopSession, 'id' | 'owner' | 'via' | 'mounts'>,
  opts: { holderUser?: string; skip?: ReadonlySet<string> } = {},
): Promise<LeaseOutcome> {
  const wsMounts = workspaceMountsOf(session).filter((m) => !opts.skip?.has(m.workspace_id!))
  if (wsMounts.length === 0) return { mounts: session.mounts, notices: [] }
  const svc = await workspaceServiceOrThrow()
  const notices: string[] = []

  const wanted: Wanted[] = wsMounts.map((mount) => {
    const ws = svc.getState(mount.workspace_id!)
    if (!ws) throw new SessionWorkspaceError(`workspace ${mount.workspace_id} not found`, 404)
    if (mount.mount_mode !== 'rw') return { mount, mode: 'read' as const, degradedReason: null }
    const w = svc.leases.writer(ws.id)
    if (w && w.holder.id !== session.id) {
      return {
        mount,
        mode: 'read' as const,
        degradedReason: `workspace ${ws.name} (${ws.id}) is being written by ${holderText(w.holder)}; mounted read-only`,
      }
    }
    return { mount, mode: 'write' as const, degradedReason: null }
  })

  const holder = { kind: 'session' as HolderKind, id: session.id, label: sessionLeaseLabel(session.id) }
  let leases: Lease[] = []
  for (let attempt = 0; attempt <= wanted.length; attempt++) {
    try {
      leases = await svc.acquireLeases(
        wanted.map((w) => ({
          workspaceId: w.mount.workspace_id!,
          mode: w.mode,
          holder: { ...holder, user: opts.holderUser ?? session.owner.email },
          ownerSub: session.owner.sub,
          ownerEmail: session.owner.email,
        })),
      )
      break
    } catch (err) {
      // Lost a race for a write lease / quota: degrade that mount and try again.
      if (!(err instanceof LeaseError)) throw err
      const target =
        err.status === 423 || err.status === 507
          ? wanted.find((w) => w.mode === 'write' && err.message.startsWith(`${w.mount.workspace_id}:`))
          : undefined
      if (!target) throw new SessionWorkspaceError(err.message, err.status === 423 ? 409 : err.status, err.holder)
      const ws = svc.getState(target.mount.workspace_id!)
      target.mode = 'read'
      target.degradedReason =
        err.status === 507
          ? `workspace ${ws?.name} (${target.mount.workspace_id}) is over its quota; mounted read-only`
          : `workspace ${ws?.name} (${target.mount.workspace_id}) is being written by ${err.holder ? holderText(err.holder) : 'another holder'}; mounted read-only`
    }
  }
  if (leases.length !== wanted.length) throw new SessionWorkspaceError('could not acquire workspace leases', 409)

  const byMount = new Map<SessionMount, { lease: Lease; w: Wanted }>()
  wanted.forEach((w, i) => byMount.set(w.mount, { lease: leases[i]!, w }))
  const mounts: SessionMount[] = []
  for (const m of session.mounts) {
    const hit = byMount.get(m)
    if (!hit) {
      mounts.push(m)
      continue
    }
    const ws = svc.getState(m.workspace_id!)
    await auditLease(session, 'workspace.lease.acquire', ws, hit.lease, { effective_mode: hit.w.mode === 'write' ? 'rw' : 'ro' })
    if (hit.w.degradedReason) notices.push(hit.w.degradedReason)
    mounts.push({ ...m, effective_mode: hit.w.mode === 'write' ? ('rw' as const) : ('ro' as const), lease_id: hit.lease.id })
  }
  return { mounts, notices }
}

/** Release every lease this session holds. Callers remove the container first. */
export async function releaseSessionLeases(
  session: Pick<DesktopSession, 'id' | 'owner' | 'via' | 'mounts'>,
  reason: string,
): Promise<number> {
  const svc = getWorkspaceService()
  if (!svc) return 0
  let n = 0
  const seen = new Set<string>()
  const ids = workspaceMountsOf(session).map((m) => m.lease_id).filter((x): x is string => !!x)
  // Also sweep by holder so a lease recorded after a crash (before the mount JSON was saved) is not orphaned.
  for (const l of svc.leases.all()) {
    if (l.holder.kind === 'session' && l.holder.id === session.id) ids.push(l.id)
  }
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    const lease = await svc.leases.release(id)
    if (!lease) continue
    n++
    await auditLease(session, 'workspace.lease.release', svc.getState(lease.workspace_id), lease, { reason })
  }
  return n
}

/** Strip lease bookkeeping after release so a stale lease_id is never trusted. */
export function clearedLeaseMounts(mounts: SessionMount[]): SessionMount[] {
  return mounts.map((m) => (isWorkspaceMount(m) ? { ...m, lease_id: null } : m))
}

export type WorkspaceDockerMounts = { args: string[]; env: string[] }

/**
 * Docker `run` pieces for a session's workspace mounts: the per-generation overlay
 * volumes (ro for read leases), PUID/PGID/UMASK for the guest user, and the §6.1
 * tamper check before any rw mount.
 */
export async function workspaceDockerMounts(session: DesktopSession): Promise<WorkspaceDockerMounts> {
  const wsMounts = workspaceMountsOf(session)
  const out: WorkspaceDockerMounts = { args: [], env: [] }
  if (wsMounts.length === 0) return out
  const svc = await workspaceServiceOrThrow()
  let user: string | null = null
  for (const m of wsMounts) {
    const ws = svc.getState(m.workspace_id!)
    if (!ws) throw new SessionWorkspaceError(`workspace ${m.workspace_id} no longer exists`, 409)
    const lease = m.lease_id ? svc.leases.get(m.lease_id) : undefined
    if (!lease || lease.holder.id !== session.id) {
      throw new SessionWorkspaceError(`workspace ${ws.id}: lease lost before start`, 409)
    }
    const mode = m.effective_mode === 'rw' ? 'rw' : 'ro'
    if (mode === 'rw') {
      try {
        await verifyUpperHash(svc, ws, lease)
      } catch (err) {
        if (err instanceof LeaseError && err.code === 'workspace_changed') {
          throw new SessionWorkspaceError(
            `workspace ${ws.id} changed after the write lease was granted; refusing to mount it read-write (tamper check)`,
            409,
          )
        }
        throw err
      }
    }
    // Authz was checked with the caller's identity at create/connect; the lease is bound to the owner.
    const spec = await mountSpecFor(svc, ws, lease, mode, m.mount_path, {
      user: { sub: session.owner.sub, iss: session.owner.iss, email: session.owner.email, name: session.owner.name } as SessionUser,
      authorize: () => ({ allow: true }),
    })
    const opts = [`type=${spec.type}`, `source=${spec.source}`, `target=${spec.target}`]
    if (spec.type === 'volume') opts.push('volume-nocopy')
    if (spec.readonly) opts.push('readonly')
    out.args.push('--mount', opts.join(','))
    if (mode === 'rw' && spec.user) user = spec.user
  }
  // linuxserver/rdesktop starts as root and drops to PUID/PGID, so the configured
  // workspace uid/gid replace --user (which would break its init).
  if (user) {
    const [uid, gid] = user.split(':')
    out.env.push('PUID=' + uid, 'PGID=' + (gid ?? uid))
  }
  out.env.push('UMASK=002')
  return out
}

/** Re-take or extend leases of running sessions; runs on an interval. */
export async function renewSessionLeases(): Promise<{ renewed: number; lost: number }> {
  const svc = getWorkspaceService()
  let renewed = 0
  let lost = 0
  if (!svc) return { renewed, lost }
  for (const s of await listSessionsWithStatus('provisioning', 'ready', 'connected', 'stopping')) {
    const wm = workspaceMountsOf(s)
    if (wm.length === 0) continue
    const missing: SessionMount[] = []
    for (const m of wm) {
      // On-demand workspaces are leased at provision time, once they are ready.
      if (!m.lease_id && s.status === 'provisioning') continue
      if (m.lease_id && svc.leases.get(m.lease_id)) {
        try {
          await svc.leases.renew(m.lease_id)
          renewed++
          continue
        } catch {
          /* expired between get and renew */
        }
      }
      missing.push(m)
    }
    if (missing.length === 0) continue
    lost += missing.length
    const cur = await getSessionRecord(s.id)
    if (!cur) continue
    const notices = [...(cur.notices ?? [])]
    for (const m of missing) {
      const msg = `workspace ${m.workspace_id}: the lease expired while this session was running; the mount is no longer protected`
      if (!notices.includes(msg)) notices.push(msg)
    }
    await updateSession(s.id, { notices })
  }
  return { renewed, lost }
}

let renewTimer: NodeJS.Timeout | null = null
export function startSessionLeaseRenewer(intervalMs = 60_000): void {
  if (renewTimer) return
  renewTimer = setInterval(() => void renewSessionLeases().catch((e) => console.warn('[sessions] lease renew failed:', e)), intervalMs)
  renewTimer.unref()
}
export function stopSessionLeaseRenewerForTest(): void {
  if (renewTimer) clearInterval(renewTimer)
  renewTimer = null
}

/** Workspaces of this session that are still being prepared (no lease can be taken yet). */
export async function preparingWorkspaceIds(session: Pick<DesktopSession, 'mounts'>): Promise<Set<string>> {
  const out = new Set<string>()
  const wm = workspaceMountsOf(session)
  if (wm.length === 0) return out
  const svc = await workspaceServiceOrThrow()
  for (const m of wm) if (svc.getState(m.workspace_id!)?.status === 'preparing') out.add(m.workspace_id!)
  return out
}

/** Pre-flight for `new_workspace` mounts: the caller must be able to write to the repo. */
export async function authorizeNewWorkspaces(user: SessionUser, inputs: SessionMountInput[]): Promise<void> {
  for (const i of inputs) {
    if (!i.new_workspace) continue
    const { namespace, repo } = i.new_workspace
    const gate = await authorizeRepoAction(user, namespace, repo, 'workspace.write')
    if (!gate.allow) {
      throw new SessionWorkspaceError(`${gate.reason ?? 'Forbidden'} (creating a workspace in ${namespace}/${repo})`, 403)
    }
  }
}

/**
 * Create the workspaces requested via `new_workspace` and return fully resolved mount
 * inputs. `created` lists the new workspace ids so a failing create can roll them back.
 */
export async function createOnDemandWorkspaces(
  user: SessionUser,
  via: 'session' | 'pat',
  sessionId: string,
  inputs: SessionMountInput[],
  created: string[],
): Promise<ResolvedMountInput[]> {
  const svc = inputs.some((i) => i.new_workspace) ? await workspaceServiceOrThrow() : null
  const out: ResolvedMountInput[] = []
  for (const i of inputs) {
    if (i.new_workspace) {
      const nw = i.new_workspace
      const ws = await svc!.create({
        namespace: nw.namespace,
        repo: nw.repo,
        name: nw.name,
        source: nw.source,
        createdBy: { email: user.email, sub: user.sub },
      })
      created.push(ws.id)
      await appendAudit({
        actor: { sub: user.sub, iss: user.iss, email: user.email, name: user.name },
        via,
        method: 'POST',
        path: '/auth/sessions',
        status: 202,
        action: 'workspace.create',
        namespace: nw.namespace,
        repo: nw.repo,
        detail: { workspace_id: ws.id, name: ws.name, source: nw.source, session_id: sessionId, on_demand: true },
      })
      out.push({ namespace: nw.namespace, repo: nw.repo, workspace_id: ws.id, mount_mode: i.mount_mode })
    } else {
      out.push({ namespace: i.namespace!, repo: i.repo!, workspace_id: i.workspace_id!, mount_mode: i.mount_mode })
    }
  }
  return out
}

/**
 * Provision-time step for on-demand workspaces: wait (up to WORKSPACES_PREPARE_TIMEOUT_SEC)
 * until every leaseless workspace mount is `ready`, then take its lease. Returns false when
 * the session left `provisioning` in the meantime (stopped/destroyed); throws when a
 * workspace fails or disappears (the caller fails the session with that message).
 */
export async function leasePendingMounts(sessionId: string, pollMs = 250): Promise<boolean> {
  let session = await getSessionRecord(sessionId)
  if (!session) return false
  const leaseless = () => workspaceMountsOf(session!).filter((m) => !m.lease_id)
  if (leaseless().length === 0) return true
  const svc = await workspaceServiceOrThrow()
  const deadline = Date.now() + loadWorkspacesConfig().prepareTimeoutSec * 1000
  for (;;) {
    session = await getSessionRecord(sessionId)
    if (!session || session.status !== 'provisioning') return false
    let waiting = false
    for (const m of leaseless()) {
      const ws = svc.getState(m.workspace_id!)
      if (!ws) throw new SessionWorkspaceError(`workspace ${m.workspace_id} no longer exists`, 409)
      if (ws.status === 'error') {
        throw new SessionWorkspaceError(`workspace ${ws.name} (${ws.id}) failed to prepare: ${ws.last_error ?? 'unknown error'}`, 409)
      }
      if (ws.status !== 'ready') waiting = true
    }
    if (!waiting) break
    if (Date.now() > deadline) {
      throw new SessionWorkspaceError('timed out waiting for the workspace to become ready (WORKSPACES_PREPARE_TIMEOUT_SEC)', 504)
    }
    await new Promise((r) => setTimeout(r, pollMs))
  }
  const have = new Set(workspaceMountsOf(session!).filter((m) => m.lease_id).map((m) => m.workspace_id!))
  const out = await acquireSessionLeases(session!, { skip: have })
  const cur = await getSessionRecord(sessionId)
  if (!cur || cur.status !== 'provisioning') {
    await releaseSessionLeases({ ...session!, mounts: out.mounts }, 'session_left_provisioning')
    return false
  }
  await updateSession(sessionId, { mounts: out.mounts, notices: [...(cur.notices ?? []), ...out.notices] })
  return true
}
