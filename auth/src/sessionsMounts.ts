import { env } from './env.js'
import type {
  DesktopSession,
  SessionMount,
  SessionMountInput,
  SessionWorkspaceRef,
} from './sessionsTypes.js'

/** True when a mount has enough identity to materialize. */
export function mountHasSource(m: {
  workspace_id?: string | null
  pin_commit?: string | null
}): boolean {
  return Boolean(
    (m.workspace_id && String(m.workspace_id).trim()) ||
      (m.pin_commit && String(m.pin_commit).trim()),
  )
}

function safeSeg(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'x'
}

/**
 * Assign deterministic guest paths: `/data/<ns>/<repo>`, with suffix on collision.
 */
export function assignMountPaths(inputs: SessionMountInput[]): SessionMount[] {
  const used = new Set<string>()
  const out: SessionMount[] = []
  for (const raw of inputs) {
    const namespace = raw.namespace.trim()
    const repo = raw.repo.trim()
    const workspace_id =
      typeof raw.workspace_id === 'string' && raw.workspace_id.trim()
        ? raw.workspace_id.trim()
        : null
    const pin_commit =
      typeof raw.pin_commit === 'string' && raw.pin_commit.trim()
        ? raw.pin_commit.trim()
        : null
    const mount_mode = raw.mount_mode === 'ro' ? 'ro' : 'rw'
    let base = `/data/${safeSeg(namespace)}/${safeSeg(repo)}`
    if (used.has(base)) {
      const suffix = workspace_id
        ? safeSeg(workspace_id).slice(0, 16)
        : (pin_commit || 'pin').slice(0, 8)
      base = `${base}__${suffix}`
    }
    let mount_path = base
    let n = 2
    while (used.has(mount_path)) {
      mount_path = `${base}_${n}`
      n += 1
    }
    used.add(mount_path)
    out.push({
      namespace,
      repo,
      workspace_id,
      pin_commit,
      mount_mode,
      mount_path,
    })
  }
  return out
}

/** Host-relative key under work/mounts/ for a session mount. */
export function mountWorkKey(m: SessionMount, index: number): string {
  const fromPath = m.mount_path.replace(/^\/data\/?/, '').replace(/\//g, '__')
  return safeSeg(fromPath) || `m${index}`
}

/**
 * Normalize legacy singular workspace_ref fields into mounts[].
 */
export function normalizeSessionMounts(
  session: DesktopSession,
): SessionMount[] {
  if (Array.isArray(session.mounts) && session.mounts.length > 0) {
    return session.mounts
  }
  const ref = session.workspace_ref
  if (!ref) return []
  const pin =
    typeof session.pin_commit === 'string' && session.pin_commit.trim()
      ? session.pin_commit.trim()
      : null
  const workspace_id = ref.workspace_id
  if (!pin && !workspace_id) return []
  const mode = session.mount_mode === 'ro' ? 'ro' : 'rw'
  return [
    {
      namespace: ref.namespace,
      repo: ref.repo,
      workspace_id,
      pin_commit: pin,
      mount_mode: mode,
      mount_path: session.mount_path || '/data',
    },
  ]
}

export function normalizeDesktopSession(
  session: DesktopSession,
): DesktopSession {
  const mounts = normalizeSessionMounts(session)
  return {
    ...session,
    mounts,
    // Keep legacy mirrors for older readers (first mount or null).
    workspace_ref: mounts[0]
      ? {
          namespace: mounts[0].namespace,
          repo: mounts[0].repo,
          workspace_id: mounts[0].workspace_id,
        }
      : null,
    pin_commit: mounts[0]?.pin_commit ?? null,
    mount_path: mounts[0]?.mount_path ?? null,
    mount_mode: mounts[0]?.mount_mode ?? null,
  }
}

export function legacyRefToMountInputs(
  workspace_ref: SessionWorkspaceRef | null | undefined,
  pin_commit: string | null | undefined,
  mount_mode: 'ro' | 'rw' | undefined,
): SessionMountInput[] {
  if (!workspace_ref) return []
  return [
    {
      namespace: workspace_ref.namespace,
      repo: workspace_ref.repo,
      workspace_id: workspace_ref.workspace_id,
      pin_commit: pin_commit ?? null,
      mount_mode: mount_mode ?? 'rw',
    },
  ]
}

export function maxMounts(): number {
  return env.sessionsMaxMounts
}
