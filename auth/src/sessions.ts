import { randomBytes } from 'node:crypto'
import { appendAudit, actorFromUser } from './audit.js'
import { authorizeInstanceAction, decideInstanceAction } from './authz.js'
import { env } from './env.js'
import { type SessionUser } from './authentication/index.js'
import { mintConnectPayload, type ConnectPayload } from './sessionsConnect.js'
import {
  assignMountPaths,
  isWorkspaceMount,
  maxMounts,
  normalizeDesktopSession,
} from './sessionsMounts.js'
import {
  acquireSessionLeases,
  authorizeNewWorkspaces,
  authorizeWorkspaceMounts,
  clearedLeaseMounts,
  createOnDemandWorkspaces,
  leasePendingMounts,
  preparingWorkspaceIds,
  releaseSessionLeases,
  resolveWorkspaceInputs,
  SessionWorkspaceError,
  workspaceIdsOf,
  workspaceServiceOrThrow,
  workspaceMountsOf,
} from './sessionsWorkspaces.js'
import { validWorkspaceId } from './workspaces/ids.js'
import {
  DOCKER_RDESKTOP_USER,
  getSessionProvisioner,
} from './sessionsProvisioner.js'
import {
  appendSession,
  countActiveForOwner,
  getSessionRecord,
  listSessions,
  listSessionsWithStatus,
  updateSession,
} from './sessionsStore.js'
import { getSessionTemplate, listSessionTemplates } from './sessionsTemplates.js'
import type {
  DesktopSession,
  PublicDesktopSession,
  SessionCreateBody,
  NewWorkspaceInput,
  SessionMount,
  SessionMountInput,
  SessionResources,
} from './sessionsTypes.js'

function newSessionId(): string {
  return randomBytes(16).toString('hex')
}

/** Map IdP identity to a Linux username (per-user; never shared). */
export function guestUserFromOwner(user: SessionUser): string {
  const email = (user.email || '').trim().toLowerCase()
  const local = email.includes('@') ? email.split('@')[0]! : ''
  const raw = (local || user.name || user.sub || 'user')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 24)
  return raw || 'miceuser'
}

function guestPassword(): string {
  return randomBytes(12).toString('base64url')
}

export function publicSession(s: DesktopSession): PublicDesktopSession {
  const normalized = normalizeDesktopSession(s)
  const { guest_password: _, ...rest } = normalized
  return { ...rest, notices: normalized.notices ?? [], workspace_ids: workspaceIdsOf(normalized) }
}

/** Audit-friendly mount description (workspace mounts carry id + effective mode). */
function mountAuditDetail(m: SessionMount) {
  return {
    namespace: m.namespace,
    repo: m.repo,
    pin_commit: m.pin_commit,
    mount_mode: m.mount_mode,
    mount_path: m.mount_path,
    ...(m.workspace_id
      ? { workspace_id: m.workspace_id, effective_mode: m.effective_mode ?? null, lease_id: m.lease_id ?? null }
      : {}),
  }
}

const WORKSPACES_ONLY = 'sessions mount workspaces: use workspace_id'

function parseNewWorkspace(raw: unknown): NewWorkspaceInput | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'new_workspace must be an object' }
  const w = raw as Record<string, unknown>
  const namespace = typeof w.namespace === 'string' ? w.namespace.trim() : ''
  const repo = typeof w.repo === 'string' ? w.repo.trim() : ''
  if (!namespace || !repo) return { error: 'new_workspace requires namespace and repo' }
  const src = w.source && typeof w.source === 'object' ? (w.source as Record<string, unknown>) : null
  const branch = typeof src?.branch === 'string' ? src.branch.trim() : ''
  const commit = typeof src?.commit === 'string' ? src.commit.trim() : ''
  if (!!branch === !!commit) return { error: 'new_workspace.source needs exactly one of branch or commit' }
  const out: NewWorkspaceInput = { namespace, repo, source: branch ? { branch } : { commit } }
  if (typeof w.name === 'string' && w.name.trim()) out.name = w.name.trim()
  return out
}

function parseMountInput(raw: unknown): SessionMountInput | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'each mount must be an object' }
  }
  const m = raw as Record<string, unknown>
  const has = (k: string) => m[k] !== undefined && m[k] !== null && m[k] !== ''
  if (has('pin_commit')) return { error: WORKSPACES_ONLY }
  const mode = m.mount_mode === 'ro' || m.mount_mode === 'rw' ? m.mount_mode : undefined
  if (has('new_workspace')) {
    if (has('workspace_id')) return { error: 'workspace_id and new_workspace are mutually exclusive' }
    const nw = parseNewWorkspace(m.new_workspace)
    if ('error' in nw) return nw
    return { new_workspace: nw, ...(mode ? { mount_mode: mode } : {}) }
  }
  if (!has('workspace_id')) return { error: WORKSPACES_ONLY }
  if (typeof m.workspace_id !== 'string' || !validWorkspaceId(m.workspace_id)) {
    return { error: 'invalid workspace_id (expected w_…)' }
  }
  // namespace/repo are derived from the workspace; when given they must match.
  return {
    workspace_id: m.workspace_id,
    namespace: typeof m.namespace === 'string' ? m.namespace.trim() : undefined,
    repo: typeof m.repo === 'string' ? m.repo.trim() : undefined,
    ...(mode ? { mount_mode: mode } : {}),
  }
}

export function parseMountsList(raw: unknown): SessionMountInput[] | { error: string } {
  if (!Array.isArray(raw)) return { error: 'mounts must be an array' }
  const mounts: SessionMountInput[] = []
  for (const item of raw) {
    const parsed = parseMountInput(item)
    if ('error' in parsed) return parsed
    mounts.push(parsed)
  }
  return mounts
}

export function parseCreateBody(
  body: unknown,
): SessionCreateBody | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Invalid body' }
  }
  const b = body as Record<string, unknown>
  const out: SessionCreateBody = {}
  if (typeof b.template_id === 'string') out.template_id = b.template_id.trim()
  if (typeof b.image === 'string') out.image = b.image.trim()
  if (b.resources && typeof b.resources === 'object' && !Array.isArray(b.resources)) {
    const r = b.resources as Record<string, unknown>
    out.resources = {}
    if (typeof r.cpu === 'string') out.resources.cpu = r.cpu
    if (typeof r.memory === 'string') out.resources.memory = r.memory
    if (typeof r.disk === 'string') out.resources.disk = r.disk
  }

  // Legacy single-mount body fields are rejected rather than silently dropped.
  for (const k of ['workspace_ref', 'pin_commit', 'mount_mode']) {
    if (b[k] !== undefined && b[k] !== null) return { error: WORKSPACES_ONLY }
  }

  if (b.mounts !== undefined) {
    const mounts = parseMountsList(b.mounts)
    if ('error' in mounts) return mounts
    out.mounts = mounts
  }
  if (typeof b.recording === 'boolean') out.recording = b.recording
  return out
}

function defaultResources(partial?: Partial<SessionResources>): SessionResources {
  return {
    cpu: partial?.cpu || env.sessionsDefaultCpu,
    memory: partial?.memory || env.sessionsDefaultMemory,
    disk: partial?.disk || env.sessionsDefaultDisk,
  }
}

/** Authorize workspace mounts (effective ro → repo read, rw → repo write). Legacy pin mounts are never mounted and are skipped. */
export async function authorizeSessionMounts(
  user: SessionUser,
  mounts: SessionMount[],
): Promise<{ allow: boolean; reason?: string }> {
  return await authorizeWorkspaceMounts(user, mounts)
}

export async function authorizeSessionCreate(user: SessionUser): Promise<{
  allow: boolean
  reason?: string
}> {
  if (!env.sessionsEnabled) {
    return { allow: false, reason: 'Sessions disabled' }
  }
  return await authorizeInstanceAction(user, 'session.create')
}

export async function authorizeSessionAccess(
  user: SessionUser,
  session: DesktopSession,
  action: 'connect' | 'stop' | 'destroy' | 'read',
): Promise<{ allow: boolean; reason?: string }> {
  if (!env.sessionsEnabled) {
    return { allow: false, reason: 'Sessions disabled' }
  }
  if ((await decideInstanceAction(user, 'session.admin')).allow) return { allow: true }
  const isOwner =
    session.owner.sub === user.sub && session.owner.iss === user.iss
  if (!isOwner) {
    return {
      allow: false,
      reason: `Not session owner (need session.${action} as owner or session_admin)`,
    }
  }
  if (action === 'connect') {
    return authorizeInstanceAction(user, 'session.connect')
  }
  // Owner may stop/destroy/read their own session.
  return { allow: true }
}

export async function createDesktopSession(
  user: SessionUser,
  via: 'session' | 'pat',
  body: SessionCreateBody,
): Promise<DesktopSession> {
  const gate = await authorizeSessionCreate(user)
  if (!gate.allow) throw new Error(gate.reason || 'Forbidden')

  const active = await countActiveForOwner(user.sub, user.iss)
  if (active >= env.sessionsMaxPerUser) {
    throw new Error(
      `SESSIONS_MAX_PER_USER (${env.sessionsMaxPerUser}) reached`,
    )
  }

  let image = body.image || ''
  let templateId: string | null = body.template_id || null
  let resources = defaultResources(body.resources)
  if (templateId) {
    const tpl = getSessionTemplate(templateId)
    if (!tpl) throw new Error(`Unknown template_id: ${templateId}`)
    image = image || tpl.image
    resources = defaultResources({ ...tpl.default_resources, ...body.resources })
  }
  if (!image) {
    const first = listSessionTemplates()[0]
    image = first?.image || env.sessionsDesktopImage
    templateId = templateId || first?.id || null
  }

  const rawInputs = body.mounts ?? []
  if (rawInputs.length > maxMounts()) {
    throw new Error(`SESSIONS_MAX_MOUNTS (${maxMounts()}) exceeded`)
  }
  const wsIds = rawInputs.map((m) => m.workspace_id).filter(Boolean)
  if (new Set(wsIds).size !== wsIds.length) {
    throw new SessionWorkspaceError('a workspace can be mounted only once per session', 400)
  }
  const id = newSessionId()
  const actor = actorFromUser(user)
  const resolved = await resolveWorkspaceInputs(user, rawInputs)
  await authorizeNewWorkspaces(user, resolved)

  // From here on, workspaces created on demand are rolled back if creation fails.
  const created: string[] = []
  const rollback = async () => {
    const svc = created.length ? await workspaceServiceOrThrow().catch(() => null) : null
    for (const wid of created) await svc?.delete(wid).catch(() => undefined)
  }
  let mounts: SessionMount[]
  let notices: string[] = []
  try {
    const inputs = await createOnDemandWorkspaces(user, via, id, resolved, created)
    mounts = assignMountPaths(inputs)
    const mountGate = await authorizeSessionMounts(user, mounts)
    if (!mountGate.allow) {
      throw new Error(mountGate.reason || 'mount requires repository access')
    }
    // Existing (ready) workspaces are leased now; on-demand ones at provision time.
    if (mounts.length > 0) {
      const out = await acquireSessionLeases({ id, owner: actor, via, mounts }, { skip: new Set(created) })
      mounts = out.mounts
      notices = out.notices
    }
  } catch (err) {
    await rollback()
    throw err
  }
  const now = new Date().toISOString()
  const first = mounts[0] ?? null
  const session: DesktopSession = normalizeDesktopSession({
    id,
    status: 'provisioning',
    owner: actor,
    via,
    template_id: templateId,
    image,
    image_digest: null,
    provisioner: env.sessionsProvisioner,
    endpoints: null,
    guest_user:
      env.sessionsProvisioner === 'docker'
        ? DOCKER_RDESKTOP_USER
        : guestUserFromOwner(user),
    guest_password: guestPassword(),
    mounts,
    workspace_ref: first
      ? {
          namespace: first.namespace,
          repo: first.repo,
        }
      : null,
    pin_commit: first?.pin_commit ?? null,
    mount_path: first?.mount_path ?? null,
    mount_mode: first?.mount_mode ?? null,
    resources,
    recording: Boolean(body.recording) || env.sessionsRecording,
    last_activity_at: now,
    connected_at: null,
    rustguac_session_id: null,
    created_at: now,
    ready_at: null,
    stopped_at: null,
    destroyed_at: null,
    error: null,
    runtime_id: null,
    notices,
  })
  try {
    await appendSession(session)
  } catch (err) {
    await releaseSessionLeases(session, 'create_failed')
    await rollback()
    throw err
  }
  await appendAudit({
    actor: session.owner,
    via,
    method: 'POST',
    path: '/auth/sessions',
    status: 201,
    action: 'session.create',
    detail: {
      session_id: id,
      image,
      template_id: templateId,
      mounts: mounts.map(mountAuditDetail),
    },
  })

  void provisionInBackground(id)
  return session
}

/** Remove the container first, then release the workspace leases (§4.4). */
export async function teardownWorkspaceMounts(
  session: DesktopSession,
  provisioner: { destroy: (s: DesktopSession) => Promise<void> },
  reason: string,
): Promise<void> {
  const cur = await getSessionRecord(session.id) ?? session
  if (workspaceMountsOf(cur).length === 0) return
  await provisioner.destroy(cur).catch(() => undefined)
  await releaseSessionLeases(cur, reason).catch((e) => console.warn('[sessions] lease release failed:', e))
  await updateSession(cur.id, { mounts: clearedLeaseMounts((await getSessionRecord(cur.id))?.mounts ?? cur.mounts) })
}

const provisioningInFlight = new Set<string>()

async function provisionInBackground(id: string): Promise<void> {
  if (provisioningInFlight.has(id)) return
  provisioningInFlight.add(id)
  const session = await getSessionRecord(id)
  if (!session) {
    provisioningInFlight.delete(id)
    return
  }
  if (session.status !== 'provisioning') {
    provisioningInFlight.delete(id)
    return
  }
  const provisioner = getSessionProvisioner(session.provisioner)
  console.log(
    `[sessions] starting provision ${id} via ${session.provisioner} image=${session.image}`,
  )
  try {
    // On-demand workspaces: wait until ready, then lease them (§ Sessions 11a).
    if (!(await leasePendingMounts(id))) return
    const result = await provisioner.provision(await getSessionRecord(id) ?? session)
    await updateSession(id, {
      status: 'ready',
      endpoints: result.endpoints,
      runtime_id: result.runtimeId,
      image_digest: result.imageDigest,
      ready_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      error: null,
    })
    await appendAudit({
      actor: session.owner,
      via: session.via,
      method: 'POST',
      path: `/auth/sessions/${id}`,
      status: 200,
      action: 'session.ready',
      detail: { session_id: id, owner: { sub: session.owner.sub, iss: session.owner.iss } },
    })
    console.log(`[sessions] provision ${id} succeeded`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'provision failed'
    console.error(`[sessions] provision ${id} failed:`, msg)
    await updateSession(id, {
      status: 'failed',
      error: msg,
      stopped_at: new Date().toISOString(),
    })
    await teardownWorkspaceMounts(session, provisioner, 'provision_failed')
    await appendAudit({
      actor: session.owner,
      via: session.via,
      method: 'POST',
      path: `/auth/sessions/${id}`,
      status: 500,
      action: 'session.create',
      message: msg,
      detail: { session_id: id, failed: true },
    })
    await appendAudit({
      actor: session.owner,
      via: session.via,
      method: 'POST',
      path: `/auth/sessions/${id}`,
      status: 200,
      action: 'session.fail',
      detail: { session_id: id, owner: { sub: session.owner.sub, iss: session.owner.iss } },
    })
  } finally {
    provisioningInFlight.delete(id)
  }
}

/** Resume or fail Sessions left in `provisioning` after auth restart. */
export async function resumeInterruptedProvisions(): Promise<void> {
  for (const s of await listSessionsWithStatus('provisioning')) {
    console.log(`[sessions] resuming interrupted provision ${s.id}`)
    void provisionInBackground(s.id)
  }
}

export async function listDesktopSessions(opts: {
  user: SessionUser
  all?: boolean
  workspaceId?: string
  /** Sessions mounting any workspace of this repo (both required together). */
  namespace?: string
  repo?: string
}): Promise<PublicDesktopSession[]> {
  const admin = (await decideInstanceAction(opts.user, 'session.admin')).allow
  return ((((((await listSessions())
    .filter((s) => s.status !== 'destroyed'))
    .filter((s) => !opts.workspaceId || workspaceIdsOf(s).includes(opts.workspaceId)))
    .filter(
      (s) =>
        !opts.namespace ||
        workspaceMountsOf(s).some((m) => m.namespace === opts.namespace && (!opts.repo || m.repo === opts.repo)),
    ))
    .filter(
      (s) =>
        opts.all && admin
          ? true
          : s.owner.sub === opts.user.sub && s.owner.iss === opts.user.iss,
    ))
    .map(publicSession))
}

export async function connectDesktopSession(
  user: SessionUser,
  via: 'session' | 'pat',
  id: string,
): Promise<{ session: PublicDesktopSession; connect: ConnectPayload }> {
  const session = await getSessionRecord(id)
  if (!session || session.status === 'destroyed') {
    throw Object.assign(new Error('Not found'), { status: 404 })
  }
  const gate = await authorizeSessionAccess(user, session, 'connect')
  if (!gate.allow) {
    throw Object.assign(new Error(gate.reason || 'Forbidden'), { status: 403 })
  }
  if (session.status !== 'ready' && session.status !== 'connected') {
    throw Object.assign(
      new Error(`Session not connectable (status=${session.status})`),
      { status: 409 },
    )
  }
  if (session.provisioner === 'mock') {
    throw Object.assign(
      new Error(
        'This Session used the mock provisioner (no real desktop). Recreate with SESSIONS_PROVISIONER=docker and ensure guacd can reach the guest on the Compose network.',
      ),
      { status: 409 },
    )
  }
  const mounts = session.mounts ?? []
  const mountGate = await authorizeSessionMounts(user, mounts)
  if (!mountGate.allow) {
    throw Object.assign(
      new Error(
        mountGate.reason ||
          'Mount access revoked; stop or destroy this session, or restore repository access',
      ),
      { status: mountGate.status ?? 403 },
    )
  }
  const connect = await mintConnectPayload(session)
  const now = new Date().toISOString()
  const updated =
    await updateSession(id, {
      status: 'connected',
      connected_at: now,
      last_activity_at: now,
      rustguac_session_id:
        connect.backend === 'rustguac' ? connect.ticket : null,
    }) ?? session
  await appendAudit({
    actor: actorFromUser(user),
    via,
    method: 'POST',
    path: `/auth/sessions/${id}/connect`,
    status: 200,
    action: 'session.connect',
    detail: {
      session_id: id,
      backend: connect.backend,
      recording: session.recording,
      mounts: mounts.map(mountAuditDetail),
    },
  })
  return { session: publicSession(updated), connect }
}

export async function stopDesktopSession(
  user: SessionUser,
  via: 'session' | 'pat',
  id: string,
): Promise<PublicDesktopSession> {
  const session = await getSessionRecord(id)
  if (!session || session.status === 'destroyed') {
    throw Object.assign(new Error('Not found'), { status: 404 })
  }
  const gate = await authorizeSessionAccess(user, session, 'stop')
  if (!gate.allow) {
    throw Object.assign(new Error(gate.reason || 'Forbidden'), { status: 403 })
  }
  await updateSession(id, { status: 'stopping' })
  const provisioner = getSessionProvisioner(session.provisioner)
  await provisioner.stop(session)
  await teardownWorkspaceMounts(session, provisioner, 'session_stopped')
  const updated =
    await updateSession(id, {
      status: 'stopped',
      stopped_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
    }) ?? session
  await appendAudit({
    actor: actorFromUser(user),
    via,
    method: 'POST',
    path: `/auth/sessions/${id}/stop`,
    status: 200,
    action: 'session.stop',
    detail: { session_id: id },
  })
  return publicSession(updated)
}

/** Re-queue a failed Session for provisioning (same id / credentials). */
export async function retryDesktopSession(
  user: SessionUser,
  via: 'session' | 'pat',
  id: string,
): Promise<PublicDesktopSession> {
  const session = await getSessionRecord(id)
  if (!session || session.status === 'destroyed') {
    throw Object.assign(new Error('Not found'), { status: 404 })
  }
  const gate = await authorizeSessionAccess(user, session, 'stop')
  if (!gate.allow) {
    throw Object.assign(new Error(gate.reason || 'Forbidden'), { status: 403 })
  }
  if (session.status !== 'failed' && session.status !== 'stopped') {
    throw Object.assign(
      new Error(`Retry only for failed/stopped (status=${session.status})`),
      { status: 409 },
    )
  }
  let mounts = session.mounts
  const notices: string[] = []
  if (workspaceMountsOf(session).length > 0) {
    const mountGate = await authorizeSessionMounts(user, mounts)
    if (!mountGate.allow) {
      throw Object.assign(new Error(mountGate.reason || 'Forbidden'), { status: 403 })
    }
    try {
      const out = await acquireSessionLeases({ ...session, mounts }, { skip: await preparingWorkspaceIds(session) })
      notices.push(...out.notices)
      mounts = out.mounts
    } catch (err) {
      if (err instanceof SessionWorkspaceError) {
        throw Object.assign(new Error(err.message), { status: err.status })
      }
      throw err
    }
  }
  const updated =
    await updateSession(id, {
      status: 'provisioning',
      mounts,
      notices,
      error: null,
      endpoints: null,
      runtime_id: null,
      ready_at: null,
      stopped_at: null,
      last_activity_at: new Date().toISOString(),
    }) ?? session
  await appendAudit({
    actor: actorFromUser(user),
    via,
    method: 'POST',
    path: `/auth/sessions/${id}/retry`,
    status: 200,
    action: 'session.retry',
    detail: { session_id: id },
  })
  void provisionInBackground(id)
  return publicSession(updated)
}

/**
 * Upgrade a session whose `rw` workspace mount was downgraded to `ro` (the writer has
 * since ended): stop+reprovision keeping the session id — remove the container, release
 * the leases, re-evaluate them, start again. Guest state outside the mounts is lost.
 */
export async function remountDesktopSession(
  user: SessionUser,
  via: 'session' | 'pat',
  id: string,
  sel: { workspace_id?: string; mount_path?: string } = {},
): Promise<PublicDesktopSession> {
  const session = await getSessionRecord(id)
  if (!session || session.status === 'destroyed') {
    throw Object.assign(new Error('Not found'), { status: 404 })
  }
  const gate = await authorizeSessionAccess(user, session, 'stop')
  if (!gate.allow) {
    throw Object.assign(new Error(gate.reason || 'Forbidden'), { status: 403 })
  }
  if (!['ready', 'connected', 'stopped', 'failed'].includes(session.status)) {
    throw Object.assign(new Error(`Remount not possible while status=${session.status}`), { status: 409 })
  }
  const targets = workspaceMountsOf(session).filter(
    (m) =>
      m.mount_mode === 'rw' &&
      m.effective_mode !== 'rw' &&
      (!sel.workspace_id || m.workspace_id === sel.workspace_id) &&
      (!sel.mount_path || m.mount_path === sel.mount_path),
  )
  if (targets.length === 0) {
    throw Object.assign(new Error('No read-only workspace mount that was requested read-write'), { status: 409 })
  }
  const mountGate = await authorizeSessionMounts(user, session.mounts.map((m) => ({ ...m, effective_mode: m.mount_mode })))
  if (!mountGate.allow) {
    throw Object.assign(new Error(mountGate.reason || 'Forbidden'), { status: 403 })
  }
  const svc = await import('./sessionsWorkspaces.js').then((m) => m.workspaceServiceOrThrow())
  for (const t of targets) {
    const w = svc.leases.writer(t.workspace_id!)
    if (w && w.holder.id !== session.id) {
      throw Object.assign(
        new Error(`workspace ${t.workspace_id} is still being written by ${w.holder.kind} ${w.holder.label ?? w.holder.id}`),
        { status: 423, holder: w.holder },
      )
    }
  }
  const provisioner = getSessionProvisioner(session.provisioner)
  await provisioner.destroy(session).catch(() => undefined)
  await releaseSessionLeases(session, 'remount')
  const released = clearedLeaseMounts(session.mounts)
  let out
  try {
    out = await acquireSessionLeases({ ...session, mounts: released })
  } catch (err) {
    await updateSession(id, {
      status: 'failed',
      mounts: released,
      error: err instanceof Error ? err.message : 'remount failed',
      endpoints: null,
      runtime_id: null,
    })
    const status = err instanceof SessionWorkspaceError ? err.status : 409
    throw Object.assign(new Error(err instanceof Error ? err.message : 'remount failed'), { status })
  }
  const updated =
    await updateSession(id, {
      status: 'provisioning',
      mounts: out.mounts,
      notices: out.notices,
      error: null,
      endpoints: null,
      runtime_id: null,
      ready_at: null,
      stopped_at: null,
      connected_at: null,
      last_activity_at: new Date().toISOString(),
    }) ?? session
  await appendAudit({
    actor: actorFromUser(user),
    via,
    method: 'POST',
    path: `/auth/sessions/${id}/remount`,
    status: 200,
    action: 'session.remount',
    detail: { session_id: id, mounts: out.mounts.filter(isWorkspaceMount).map(mountAuditDetail) },
  })
  void provisionInBackground(id)
  return publicSession(updated)
}

/**
 * Replace the full mount list of an existing session (stop + reprovision, same session id
 * and guest user). Mounts that keep their workspace_id keep their guest path; leases of
 * removed/changed mounts are released; on-demand workspaces are leased at provision time.
 */
export async function updateSessionMounts(
  user: SessionUser,
  via: 'session' | 'pat',
  id: string,
  rawInputs: SessionMountInput[],
): Promise<PublicDesktopSession> {
  const session = await getSessionRecord(id)
  if (!session || session.status === 'destroyed') {
    throw Object.assign(new Error('Not found'), { status: 404 })
  }
  const gate = await authorizeSessionAccess(user, session, 'stop')
  if (!gate.allow) throw Object.assign(new Error(gate.reason || 'Forbidden'), { status: 403 })
  if (!['ready', 'connected', 'stopped', 'failed'].includes(session.status)) {
    throw Object.assign(new Error(`Mounts cannot be changed while status=${session.status}`), { status: 409 })
  }
  if (rawInputs.length > maxMounts()) {
    throw new SessionWorkspaceError(`SESSIONS_MAX_MOUNTS (${maxMounts()}) exceeded`, 400)
  }
  const wsIds = rawInputs.map((m) => m.workspace_id).filter(Boolean)
  if (new Set(wsIds).size !== wsIds.length) {
    throw new SessionWorkspaceError('a workspace can be mounted only once per session', 400)
  }
  const before = workspaceMountsOf(session).map(mountAuditDetail)
  const resolved = await resolveWorkspaceInputs(user, rawInputs)
  await authorizeNewWorkspaces(user, resolved)

  const created: string[] = []
  const rollback = async () => {
    const svc = created.length ? await workspaceServiceOrThrow().catch(() => null) : null
    for (const wid of created) await svc?.delete(wid).catch(() => undefined)
  }
  let mounts: SessionMount[]
  try {
    const inputs = await createOnDemandWorkspaces(user, via, id, resolved, created)
    const keep = new Map(workspaceMountsOf(session).map((m) => [m.workspace_id!, m.mount_path]))
    mounts = assignMountPaths(inputs, keep)
    const mountGate = await authorizeSessionMounts(user, mounts)
    if (!mountGate.allow) throw new SessionWorkspaceError(mountGate.reason || 'mount requires repository access', 403)
  } catch (err) {
    await rollback()
    throw err
  }

  const provisioner = getSessionProvisioner(session.provisioner)
  await provisioner.destroy(session).catch(() => undefined)
  await releaseSessionLeases(session, 'mounts_update')
  let out: { mounts: SessionMount[]; notices: string[] } = { mounts, notices: [] }
  try {
    if (mounts.length > 0) {
      out = await acquireSessionLeases(
        { id, owner: session.owner, via: session.via, mounts },
        { skip: new Set(created) },
      )
    }
  } catch (err) {
    await rollback()
    await updateSession(id, {
      status: 'failed',
      mounts: [],
      notices: [],
      error: err instanceof Error ? err.message : 'mount update failed',
      endpoints: null,
      runtime_id: null,
    })
    const status = err instanceof SessionWorkspaceError ? err.status : 409
    throw Object.assign(new Error(err instanceof Error ? err.message : 'mount update failed'), { status })
  }
  const first = out.mounts[0] ?? null
  const updated =
    await updateSession(id, {
      status: 'provisioning',
      mounts: out.mounts,
      notices: out.notices,
      workspace_ref: first ? { namespace: first.namespace, repo: first.repo } : null,
      pin_commit: null,
      mount_path: first?.mount_path ?? null,
      mount_mode: first?.mount_mode ?? null,
      error: null,
      endpoints: null,
      runtime_id: null,
      ready_at: null,
      stopped_at: null,
      connected_at: null,
      last_activity_at: new Date().toISOString(),
    }) ?? session
  await appendAudit({
    actor: actorFromUser(user),
    via,
    method: 'PUT',
    path: `/auth/sessions/${id}/mounts`,
    status: 200,
    action: 'session.mounts.update',
    detail: { session_id: id, before, after: out.mounts.map(mountAuditDetail) },
  })
  void provisionInBackground(id)
  return publicSession(updated)
}

export async function destroyDesktopSession(
  user: SessionUser,
  via: 'session' | 'pat',
  id: string,
): Promise<PublicDesktopSession> {
  const session = await getSessionRecord(id)
  if (!session) {
    throw Object.assign(new Error('Not found'), { status: 404 })
  }
  if (session.status === 'destroyed') return publicSession(session)
  const gate = await authorizeSessionAccess(user, session, 'destroy')
  if (!gate.allow) {
    throw Object.assign(new Error(gate.reason || 'Forbidden'), { status: 403 })
  }
  const provisioner = getSessionProvisioner(session.provisioner)
  await provisioner.destroy(session)
  await teardownWorkspaceMounts(session, provisioner, 'session_destroyed')
  const updated =
    await updateSession(id, {
      status: 'destroyed',
      destroyed_at: new Date().toISOString(),
      endpoints: null,
      runtime_id: null,
    }) ?? session
  await appendAudit({
    actor: actorFromUser(user),
    via,
    method: 'DELETE',
    path: `/auth/sessions/${id}`,
    status: 200,
    action: 'session.destroy',
    detail: { session_id: id },
  })
  return publicSession(updated)
}

export async function markSessionDisconnect(
  user: SessionUser,
  via: 'session' | 'pat',
  id: string,
): Promise<PublicDesktopSession | null> {
  const session = await getSessionRecord(id)
  if (!session) return null
  const gate = await authorizeSessionAccess(user, session, 'connect')
  if (!gate.allow) return null
  const updated = await updateSession(id, {
    status: session.status === 'destroyed' ? 'destroyed' : 'ready',
    last_activity_at: new Date().toISOString(),
  })
  await appendAudit({
    actor: actorFromUser(user),
    via,
    method: 'POST',
    path: `/auth/sessions/${id}/disconnect`,
    status: 200,
    action: 'session.disconnect',
    detail: { session_id: id },
  })
  return updated ? publicSession(updated) : null
}

/** Phase 1: idle + max lifetime sweeper */
export function startSessionsLifecycleSweeper(): void {
  if (!env.sessionsEnabled) return
  const tick = async () => {
    const now = Date.now()
    for (const s of await listSessions()) {
      if (
        s.status !== 'ready' &&
        s.status !== 'connected' &&
        s.status !== 'provisioning'
      ) {
        continue
      }
      const created = Date.parse(s.created_at)
      if (
        env.sessionsMaxLifetimeSec > 0 &&
        Number.isFinite(created) &&
        now - created > env.sessionsMaxLifetimeSec * 1000
      ) {
        try {
          const provisioner = getSessionProvisioner(s.provisioner)
          await provisioner.destroy(s)
          await teardownWorkspaceMounts(s, provisioner, 'max_lifetime')
          await updateSession(s.id, {
            status: 'destroyed',
            destroyed_at: new Date().toISOString(),
            error: 'max lifetime exceeded',
          })
          await appendAudit({
            actor: s.owner,
            via: s.via,
            method: 'SYSTEM',
            path: `/auth/sessions/${s.id}`,
            status: 200,
            action: 'session.destroy',
            detail: {
              session_id: s.id,
              owner: { sub: s.owner.sub, iss: s.owner.iss },
              reason: 'max_lifetime',
            },
          })
        } catch {
          /* best-effort */
        }
        continue
      }
      const last = Date.parse(s.last_activity_at || s.ready_at || s.created_at)
      if (
        env.sessionsIdleTimeoutSec > 0 &&
        Number.isFinite(last) &&
        now - last > env.sessionsIdleTimeoutSec * 1000 &&
        (s.status === 'ready' || s.status === 'connected')
      ) {
        try {
          const provisioner = getSessionProvisioner(s.provisioner)
          await provisioner.stop(s)
          await teardownWorkspaceMounts(s, provisioner, 'idle_timeout')
          await updateSession(s.id, {
            status: 'stopped',
            stopped_at: new Date().toISOString(),
            error: 'idle timeout',
          })
          await appendAudit({
            actor: s.owner,
            via: s.via,
            method: 'SYSTEM',
            path: `/auth/sessions/${s.id}/stop`,
            status: 200,
            action: 'session.stop',
            detail: {
              session_id: s.id,
              owner: { sub: s.owner.sub, iss: s.owner.iss },
              reason: 'idle_timeout',
            },
          })
        } catch {
          /* best-effort */
        }
      }
    }
  }
  setInterval(() => {
    void tick()
  }, 60_000)
}

/** Phase 3: retention policy note for session audit actions (no purge by default). */
export function sessionsAuditRetentionPolicy(): {
  retention_days: number
  purge_enabled: boolean
  actions: string[]
} {
  return {
    retention_days: env.sessionsAuditRetentionDays,
    purge_enabled: false,
    actions: [
      'session.create',
      'session.connect',
      'session.disconnect',
      'session.stop',
      'session.destroy',
    ],
  }
}
