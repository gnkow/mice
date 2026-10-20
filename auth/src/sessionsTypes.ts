import type { AuditActor, AuditVia } from './audit.js'

export type DesktopSessionStatus =
  | 'provisioning'
  | 'ready'
  | 'connected'
  | 'stopping'
  | 'stopped'
  | 'failed'
  | 'destroyed'

export type SessionsProvisionerKind =
  | 'docker'
  | 'libvirt'
  | 'kubevirt'
  | 'mock'

export type SessionResources = {
  cpu: string
  memory: string
  disk: string
}

export type SessionEndpoints = {
  rdp_host: string
  rdp_port: number
  /** Docker network name / alias for guacd reachability */
  container_name: string | null
}

/** @deprecated Prefer SessionMount; kept for legacy create bodies / records. */
export type SessionWorkspaceRef = {
  namespace: string
  repo: string
  workspace_id: string | null
}

/** One Oxen workspace or commit pin bind-mounted into the guest. */
export type SessionMount = {
  namespace: string
  repo: string
  workspace_id: string | null
  /** Required when workspace_id is null. */
  pin_commit: string | null
  mount_mode: 'ro' | 'rw'
  /** Server-assigned guest path, e.g. /data/ns/repo */
  mount_path: string
}

/** Client-supplied mount before path assignment. */
export type SessionMountInput = {
  namespace: string
  repo: string
  workspace_id?: string | null
  pin_commit?: string | null
  mount_mode?: 'ro' | 'rw'
}

export type DesktopSession = {
  id: string
  status: DesktopSessionStatus
  owner: AuditActor
  via: AuditVia
  /** Template id from catalog, or raw image ref */
  template_id: string | null
  image: string
  image_digest: string | null
  provisioner: SessionsProvisionerKind
  endpoints: SessionEndpoints | null
  /** Linux username for RDP (per-user; never a shared account) */
  guest_user: string
  /** Redacted in public API */
  guest_password: string
  /** Zero or more workspace/commit mounts (create-time only). */
  mounts: SessionMount[]
  /**
   * Legacy single-mount fields — kept for JSONL records written before mounts[].
   * Prefer `mounts`; normalizeSession fills mounts from these when missing.
   */
  workspace_ref?: SessionWorkspaceRef | null
  pin_commit?: string | null
  mount_path?: string | null
  mount_mode?: 'ro' | 'rw' | null
  resources: SessionResources
  recording: boolean
  /** ISO when idle timer / last activity updated */
  last_activity_at: string | null
  connected_at: string | null
  rustguac_session_id: string | null
  created_at: string
  ready_at: string | null
  stopped_at: string | null
  destroyed_at: string | null
  error: string | null
  runtime_id: string | null
}

export type SessionCreateBody = {
  template_id?: string
  image?: string
  resources?: Partial<SessionResources>
  /** Preferred: one or more mounts. */
  mounts?: SessionMountInput[]
  /** @deprecated Use mounts[]; converted to a single mount when mounts omitted. */
  workspace_ref?: SessionWorkspaceRef | null
  /** @deprecated Use mounts[].pin_commit */
  pin_commit?: string | null
  /** @deprecated Use mounts[].mount_mode */
  mount_mode?: 'ro' | 'rw'
  recording?: boolean
}

export type SessionTemplate = {
  id: string
  name: string
  description: string
  image: string
  provisioner: SessionsProvisionerKind
  default_resources: SessionResources
}

export type PublicDesktopSession = Omit<DesktopSession, 'guest_password'>
