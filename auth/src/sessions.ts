import { randomBytes } from 'node:crypto'
import { appendAudit, actorFromUser } from './audit.js'
import { authorizeJobRead, authorizeJobSubmit } from './authz.js'
import {
  hasInstancePermission,
  isAuthzEnforce,
  isInstanceAdmin,
} from './authzStore.js'
import { env } from './env.js'
import type { SessionUser } from './session.js'
import { mintConnectPayload, type ConnectPayload } from './sessionsConnect.js'
import {
  assignMountPaths,
  legacyRefToMountInputs,
  maxMounts,
  mountHasSource,
  normalizeDesktopSession,
} from './sessionsMounts.js'
import {
  DOCKER_RDESKTOP_USER,
  getSessionProvisioner,
} from './sessionsProvisioner.js'
import {
  appendSession,
  countActiveForOwner,
  getSessionRecord,
  listSessions,
  updateSession,
} from './sessionsStore.js'
import { getSessionTemplate, listSessionTemplates } from './sessionsTemplates.js'
import type {
  DesktopSession,
  PublicDesktopSession,
  SessionCreateBody,
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
  return rest
}

function parseMountInput(
  raw: unknown,
): SessionMountInput | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'each mount must be an object' }
  }
  const m = raw as Record<string, unknown>
  if (typeof m.namespace !== 'string' || typeof m.repo !== 'string') {
    return { error: 'each mount requires namespace and repo' }
  }
  const namespace = m.namespace.trim()
  const repo = m.repo.trim()
  if (!namespace || !repo) {
    return { error: 'each mount requires namespace and repo' }
  }
  const workspace_id =
    typeof m.workspace_id === 'string' && m.workspace_id.trim()
      ? m.workspace_id.trim()
      : null
  const pin_commit =
    typeof m.pin_commit === 'string' && m.pin_commit.trim()
      ? m.pin_commit.trim()
      : null
  if (!workspace_id && !pin_commit) {
    return { error: 'each mount requires workspace_id or pin_commit' }
  }
  const out: SessionMountInput = {
    namespace,
    repo,
    workspace_id,
    pin_commit,
  }
  if (m.mount_mode === 'ro' || m.mount_mode === 'rw') {
    out.mount_mode = m.mount_mode
  }
  return out
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

  if (Array.isArray(b.mounts)) {
    const mounts: SessionMountInput[] = []
    for (const item of b.mounts) {
      const parsed = parseMountInput(item)
      if ('error' in parsed) return parsed
      mounts.push(parsed)
    }
    out.mounts = mounts
  }

  if (b.workspace_ref === null) out.workspace_ref = null
  if (b.workspace_ref && typeof b.workspace_ref === 'object') {
    const w = b.workspace_ref as Record<string, unknown>
    if (typeof w.namespace !== 'string' || typeof w.repo !== 'string') {
      return { error: 'workspace_ref requires namespace and repo' }
    }
    out.workspace_ref = {
      namespace: w.namespace.trim(),
      repo: w.repo.trim(),
      workspace_id:
        typeof w.workspace_id === 'string' && w.workspace_id.trim()
          ? w.workspace_id.trim()
          : null,
    }
  }
  if (typeof b.pin_commit === 'string') out.pin_commit = b.pin_commit.trim()
  if (b.pin_commit === null) out.pin_commit = null
  if (b.mount_mode === 'ro' || b.mount_mode === 'rw') out.mount_mode = b.mount_mode
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

function resolveMountInputs(body: SessionCreateBody): SessionMountInput[] {
  if (body.mounts && body.mounts.length > 0) return body.mounts
  return legacyRefToMountInputs(
    body.workspace_ref,
    body.pin_commit,
    body.mount_mode,
  )
}

/** Authorize each mount (ro → job.read, rw → job.submit). */
export function authorizeSessionMounts(
  user: SessionUser,
  mounts: SessionMount[],
): { allow: boolean; reason?: string } {
  for (const m of mounts) {
    const gate =
      m.mount_mode === 'ro'
        ? authorizeJobRead(user, m.namespace, m.repo)
        : authorizeJobSubmit(user, m.namespace, m.repo)
    if (!gate.allow) {
      return {
        allow: false,
        reason:
          gate.reason ||
          `mount ${m.namespace}/${m.repo} requires repository access`,
      }
    }
  }
  return { allow: true }
}

export function authorizeSessionCreate(user: SessionUser): {
  allow: boolean
  reason?: string
} {
  if (!env.sessionsEnabled) {
    return { allow: false, reason: 'Sessions disabled' }
  }
  if (!isAuthzEnforce()) return { allow: true }
  if (isInstanceAdmin(user)) return { allow: true }
  if (hasInstancePermission(user, 'session_admin')) return { allow: true }
  if (hasInstancePermission(user, 'session_create')) return { allow: true }
  return { allow: false, reason: 'Missing permission session_create' }
}

function hasSessionAdmin(user: SessionUser): boolean {
  return isInstanceAdmin(user) || hasInstancePermission(user, 'session_admin')
}

export function authorizeSessionAccess(
  user: SessionUser,
  session: DesktopSession,
  action: 'connect' | 'stop' | 'destroy' | 'read',
): { allow: boolean; reason?: string } {
  if (!env.sessionsEnabled) {
    return { allow: false, reason: 'Sessions disabled' }
  }
  if (hasSessionAdmin(user)) return { allow: true }
  const isOwner =
    session.owner.sub === user.sub && session.owner.iss === user.iss
  if (!isOwner) {
    return {
      allow: false,
      reason: `Not session owner (need session.${action} as owner or session_admin)`,
    }
  }
  if (action === 'connect') {
    if (!isAuthzEnforce()) return { allow: true }
    if (hasInstancePermission(user, 'session_connect')) return { allow: true }
    return { allow: false, reason: 'Missing permission session_connect' }
  }
  // Owner may stop/destroy/read their own session.
  return { allow: true }
}

export async function createDesktopSession(
  user: SessionUser,
  via: 'session' | 'pat',
  body: SessionCreateBody,
): Promise<DesktopSession> {
  const gate = authorizeSessionCreate(user)
  if (!gate.allow) throw new Error(gate.reason || 'Forbidden')

  const active = countActiveForOwner(user.sub, user.iss)
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

  const inputs = resolveMountInputs(body)
  if (inputs.length > maxMounts()) {
    throw new Error(`SESSIONS_MAX_MOUNTS (${maxMounts()}) exceeded`)
  }
  for (const m of inputs) {
    if (!mountHasSource(m)) {
      throw new Error('each mount requires workspace_id or pin_commit')
    }
  }
  const mounts = assignMountPaths(inputs)
  const mountGate = authorizeSessionMounts(user, mounts)
  if (!mountGate.allow) {
    throw new Error(mountGate.reason || 'workspace mount requires repository access')
  }

  const id = newSessionId()
  const now = new Date().toISOString()
  const first = mounts[0] ?? null
  const session: DesktopSession = normalizeDesktopSession({
    id,
    status: 'provisioning',
    owner: actorFromUser(user),
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
          workspace_id: first.workspace_id,
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
  })
  appendSession(session)
  appendAudit({
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
      mounts: mounts.map((m) => ({
        namespace: m.namespace,
        repo: m.repo,
        workspace_id: m.workspace_id,
        pin_commit: m.pin_commit,
        mount_mode: m.mount_mode,
        mount_path: m.mount_path,
      })),
    },
  })

  void provisionInBackground(id)
  return session
}

const provisioningInFlight = new Set<string>()

async function provisionInBackground(id: string): Promise<void> {
  if (provisioningInFlight.has(id)) return
  provisioningInFlight.add(id)
  const session = getSessionRecord(id)
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
    const result = await provisioner.provision(session)
    updateSession(id, {
      status: 'ready',
      endpoints: result.endpoints,
      runtime_id: result.runtimeId,
      image_digest: result.imageDigest,
      ready_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      error: null,
    })
    console.log(`[sessions] provision ${id} succeeded`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'provision failed'
    console.error(`[sessions] provision ${id} failed:`, msg)
    updateSession(id, {
      status: 'failed',
      error: msg,
      stopped_at: new Date().toISOString(),
    })
    appendAudit({
      actor: session.owner,
      via: session.via,
      method: 'POST',
      path: `/auth/sessions/${id}`,
      status: 500,
      action: 'session.create',
      message: msg,
      detail: { session_id: id, failed: true },
    })
  } finally {
    provisioningInFlight.delete(id)
  }
}

/** Resume or fail Sessions left in `provisioning` after auth restart. */
export function resumeInterruptedProvisions(): void {
  for (const s of listSessions()) {
    if (s.status !== 'provisioning') continue
    console.log(`[sessions] resuming interrupted provision ${s.id}`)
    void provisionInBackground(s.id)
  }
}

export function listDesktopSessions(opts: {
  user: SessionUser
  all?: boolean
}): PublicDesktopSession[] {
  const admin = hasSessionAdmin(opts.user)
  return listSessions()
    .filter((s) => s.status !== 'destroyed')
    .filter(
      (s) =>
        opts.all && admin
          ? true
          : s.owner.sub === opts.user.sub && s.owner.iss === opts.user.iss,
    )
    .map(publicSession)
}

export async function connectDesktopSession(
  user: SessionUser,
  via: 'session' | 'pat',
  id: string,
): Promise<{ session: PublicDesktopSession; connect: ConnectPayload }> {
  const session = getSessionRecord(id)
  if (!session || session.status === 'destroyed') {
    throw Object.assign(new Error('Not found'), { status: 404 })
  }
  const gate = authorizeSessionAccess(user, session, 'connect')
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
  const mountGate = authorizeSessionMounts(user, mounts)
  if (!mountGate.allow) {
    throw Object.assign(
      new Error(
        mountGate.reason ||
          'Mount access revoked; stop or destroy this session, or restore repository access',
      ),
      { status: 403 },
    )
  }
  const connect = await mintConnectPayload(session)
  const now = new Date().toISOString()
  const updated =
    updateSession(id, {
      status: 'connected',
      connected_at: now,
      last_activity_at: now,
      rustguac_session_id:
        connect.backend === 'rustguac' ? connect.ticket : null,
    }) ?? session
  appendAudit({
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
      mounts: mounts.map((m) => ({
        namespace: m.namespace,
        repo: m.repo,
        workspace_id: m.workspace_id,
        pin_commit: m.pin_commit,
        mount_mode: m.mount_mode,
        mount_path: m.mount_path,
      })),
    },
  })
  return { session: publicSession(updated), connect }
}

export async function stopDesktopSession(
  user: SessionUser,
  via: 'session' | 'pat',
  id: string,
): Promise<PublicDesktopSession> {
  const session = getSessionRecord(id)
  if (!session || session.status === 'destroyed') {
    throw Object.assign(new Error('Not found'), { status: 404 })
  }
  const gate = authorizeSessionAccess(user, session, 'stop')
  if (!gate.allow) {
    throw Object.assign(new Error(gate.reason || 'Forbidden'), { status: 403 })
  }
  updateSession(id, { status: 'stopping' })
  const provisioner = getSessionProvisioner(session.provisioner)
  await provisioner.stop(session)
  const updated =
    updateSession(id, {
      status: 'stopped',
      stopped_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
    }) ?? session
  appendAudit({
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
  const session = getSessionRecord(id)
  if (!session || session.status === 'destroyed') {
    throw Object.assign(new Error('Not found'), { status: 404 })
  }
  const gate = authorizeSessionAccess(user, session, 'stop')
  if (!gate.allow) {
    throw Object.assign(new Error(gate.reason || 'Forbidden'), { status: 403 })
  }
  if (session.status !== 'failed' && session.status !== 'stopped') {
    throw Object.assign(
      new Error(`Retry only for failed/stopped (status=${session.status})`),
      { status: 409 },
    )
  }
  const updated =
    updateSession(id, {
      status: 'provisioning',
      error: null,
      endpoints: null,
      runtime_id: null,
      ready_at: null,
      stopped_at: null,
      last_activity_at: new Date().toISOString(),
    }) ?? session
  appendAudit({
    actor: actorFromUser(user),
    via,
    method: 'POST',
    path: `/auth/sessions/${id}/retry`,
    status: 200,
    action: 'session.create',
    detail: { session_id: id, retry: true },
  })
  void provisionInBackground(id)
  return publicSession(updated)
}

export async function destroyDesktopSession(
  user: SessionUser,
  via: 'session' | 'pat',
  id: string,
): Promise<PublicDesktopSession> {
  const session = getSessionRecord(id)
  if (!session) {
    throw Object.assign(new Error('Not found'), { status: 404 })
  }
  if (session.status === 'destroyed') return publicSession(session)
  const gate = authorizeSessionAccess(user, session, 'destroy')
  if (!gate.allow) {
    throw Object.assign(new Error(gate.reason || 'Forbidden'), { status: 403 })
  }
  const provisioner = getSessionProvisioner(session.provisioner)
  await provisioner.destroy(session)
  const updated =
    updateSession(id, {
      status: 'destroyed',
      destroyed_at: new Date().toISOString(),
      endpoints: null,
      runtime_id: null,
    }) ?? session
  appendAudit({
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

export function markSessionDisconnect(
  user: SessionUser,
  via: 'session' | 'pat',
  id: string,
): PublicDesktopSession | null {
  const session = getSessionRecord(id)
  if (!session) return null
  const gate = authorizeSessionAccess(user, session, 'connect')
  if (!gate.allow) return null
  const updated = updateSession(id, {
    status: session.status === 'destroyed' ? 'destroyed' : 'ready',
    last_activity_at: new Date().toISOString(),
  })
  appendAudit({
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
    for (const s of listSessions()) {
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
          updateSession(s.id, {
            status: 'destroyed',
            destroyed_at: new Date().toISOString(),
            error: 'max lifetime exceeded',
          })
          appendAudit({
            actor: s.owner,
            via: s.via,
            method: 'SYSTEM',
            path: `/auth/sessions/${s.id}`,
            status: 200,
            action: 'session.destroy',
            detail: { session_id: s.id, reason: 'max_lifetime' },
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
          updateSession(s.id, {
            status: 'stopped',
            stopped_at: new Date().toISOString(),
            error: 'idle timeout',
          })
          appendAudit({
            actor: s.owner,
            via: s.via,
            method: 'SYSTEM',
            path: `/auth/sessions/${s.id}/stop`,
            status: 200,
            action: 'session.stop',
            detail: { session_id: s.id, reason: 'idle_timeout' },
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
