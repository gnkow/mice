import { env } from './env.js'
import { validWorkspaceId } from './workspaces/ids.js'
import type {
  DesktopSession,
  SessionMount,
  ResolvedMountInput,
} from './sessionsTypes.js'

export const isWorkspaceMount = (m: { workspace_id?: string | null }): boolean =>
  Boolean(m.workspace_id && validWorkspaceId(m.workspace_id))

function safeSeg(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'x'
}

/**
 * Assign workspace-specific guest paths, independent of mount order or session.
 */
export function assignMountPaths(
  inputs: ResolvedMountInput[],
  /** workspace_id → existing guest path to preserve (mount edits). */
  keep: ReadonlyMap<string, string> = new Map(),
): SessionMount[] {
  const used = new Set<string>()
  for (const raw of inputs) {
    const k = keep.get(raw.workspace_id)
    if (k) used.add(k)
  }
  const out: SessionMount[] = []
  for (const raw of inputs) {
    const namespace = raw.namespace.trim()
    const repo = raw.repo.trim()
    const mount_mode = raw.mount_mode === 'ro' ? 'ro' : 'rw'
    const kept = keep.get(raw.workspace_id)
    if (kept) {
      out.push({ namespace, repo, pin_commit: null, mount_mode, mount_path: kept, workspace_id: raw.workspace_id })
      continue
    }
    const base = `/data/${safeSeg(namespace)}/${safeSeg(repo)}__${raw.workspace_id}`
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
      pin_commit: null,
      mount_mode,
      mount_path,
      workspace_id: raw.workspace_id,
    })
  }
  return out
}

/** Only workspace mounts exist; anything else in a stored document is dropped. */
export function normalizeSessionMounts(session: DesktopSession): SessionMount[] {
  return (session.mounts ?? []).filter(isWorkspaceMount)
}

export function normalizeDesktopSession(
  session: DesktopSession,
): DesktopSession {
  const mounts = normalizeSessionMounts(session)
  return {
    ...session,
    mounts,
    notices: session.notices ?? [],
    // Keep legacy mirrors for older readers (first mount or null).
    workspace_ref: mounts[0]
      ? {
          namespace: mounts[0].namespace,
          repo: mounts[0].repo,
        }
      : null,
    pin_commit: mounts[0]?.pin_commit ?? null,
    mount_path: mounts[0]?.mount_path ?? null,
    mount_mode: mounts[0]?.mount_mode ?? null,
  }
}

export function maxMounts(): number {
  return env.sessionsMaxMounts
}
