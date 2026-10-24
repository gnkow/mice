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
}

/**
 * One mount in the guest: a Mice workspace overlay volume (lease-backed). Records
 * written before workspaces-only sessions may hold legacy commit-pin mounts
 * (no `workspace_id`); they still load but are never mounted.
 */
export type SessionMount = {
  namespace: string
  repo: string
  pin_commit: string | null
  /** Requested mode. For workspace mounts the effective mode may be downgraded. */
  mount_mode: 'ro' | 'rw'
  /** Server-assigned guest path, e.g. /data/ns/repo */
  mount_path: string
  /** Workspace mounts only (mutually exclusive with pin_commit). */
  workspace_id?: string
  /** Workspace mounts only: what the lease actually allows. */
  effective_mode?: 'ro' | 'rw'
  /**
   * Workspace mounts only: the lease held by this session for this mount. Absent/null
   * while an on-demand workspace is still preparing (leases are taken at provision time).
   */
  lease_id?: string | null
}

/** Create a workspace on demand as part of session creation. */
export type NewWorkspaceInput = {
  namespace: string
  repo: string
  name?: string
  source: { branch: string } | { commit: string }
}

/** Client-supplied mount: an existing workspace, or one to create on demand. */
export type SessionMountInput = {
  workspace_id?: string
  new_workspace?: NewWorkspaceInput
  mount_mode?: 'ro' | 'rw'
  /** Optional; must match the workspace when given. */
  namespace?: string
  repo?: string
}

/** A mount whose workspace is known (existing or just created). */
export type ResolvedMountInput = {
  namespace: string
  repo: string
  workspace_id: string
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
  /** Zero or more workspace mounts (legacy records may hold commit pins). */
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
  /** Non-fatal messages, e.g. a workspace mount downgraded to read-only. */
  notices?: string[]
}

export type SessionCreateBody = {
  template_id?: string
  image?: string
  resources?: Partial<SessionResources>
  mounts?: SessionMountInput[]
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

export type PublicDesktopSession = Omit<DesktopSession, 'guest_password'> & {
  notices: string[]
  workspace_ids: string[]
}
