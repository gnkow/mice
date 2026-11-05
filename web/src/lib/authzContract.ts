// Authz contract: single source of truth for names shared by auth, web and the CLI.
// Edit only auth/src/authzContract.ts, then run `node scripts/sync-authz-contract.mjs`
// to refresh web/src/lib/authzContract.ts and cli/lib/authzContract.mjs (drift is a test failure).
// Keep this file dependency-free and limited to erasable TypeScript syntax.

export const INSTANCE_PERMISSIONS = [
  'create_namespace',
  'view_audit',
  'view_lineage',
  'manage_own_tokens',
  'cli_device_approve',
  'session_create',
  'session_connect',
  'session_admin',
] as const

/** Formal instance roles for RBAC (GET /auth/me/authz). */
export const INSTANCE_ROLES = ['external', 'user', 'manager', 'auditor', 'admin'] as const

export const NAMESPACE_ROLES = ['owner', 'member'] as const

export const REPO_ROLES = ['read', 'triage', 'write', 'maintain', 'admin'] as const

/**
 * Orthogonal grant, not a rank in REPO_ROLES: assigned by a namespace Owner at namespace or
 * repository scope, and required to sign a merge into a validated branch.
 */
export const APPROVER_ROLE = 'approver'

export const NAMESPACE_CAPABILITIES = [
  'manage_members',
  'manage_settings',
  'manage_custom_roles',
  'create_repos',
  'view_audit',
  'view_lineage',
  'review_access_requests',
  'delete_namespace',
] as const

export const REPO_FINE_PERMISSIONS = [
  'contents_read',
  'contents_write',
  'workspaces',
  'merge',
  'delete_branch',
  'manage_collaborators',
  'manage_repo_metadata',
  'repo_delete',
  'other_mutate',
  'job_submit',
  'job_read',
  'job_cancel',
  'job_complete',
  'lineage_read',
  'lineage_rebuild',
] as const

export type InstancePermission = (typeof INSTANCE_PERMISSIONS)[number]
export type InstanceRole = (typeof INSTANCE_ROLES)[number]
export type NamespaceRole = (typeof NAMESPACE_ROLES)[number]
export type RepoRole = (typeof REPO_ROLES)[number]
export type NamespaceCapability = (typeof NAMESPACE_CAPABILITIES)[number]
export type RepoFinePermission = (typeof REPO_FINE_PERMISSIONS)[number]

export function isInstancePermission(v: unknown): v is InstancePermission {
  return typeof v === 'string' && (INSTANCE_PERMISSIONS as readonly string[]).includes(v)
}

export function isInstanceRole(v: unknown): v is InstanceRole {
  return typeof v === 'string' && (INSTANCE_ROLES as readonly string[]).includes(v)
}

export function isRepoRole(v: unknown): v is RepoRole {
  return typeof v === 'string' && (REPO_ROLES as readonly string[]).includes(v)
}

/** Response body of GET /auth/me/authz (RBAC). */
export type AuthzMe = {
  enforce: boolean
  pending: boolean
  /** Formal role, or null when pending (no role assigned). */
  role: InstanceRole | null
  /** Role bundle ∪ custom grants. */
  effectivePermissions: string[]
  /** Full RBAC permission catalog for UI checklists. */
  permissionCatalog: string[]
  trainingCompleted?: boolean
  requireTraining?: boolean
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string')
}

/** Validate an untrusted /auth/me/authz payload; null when it does not match the contract. */
export function parseAuthzMe(raw: unknown): AuthzMe | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.enforce !== 'boolean') return null
  if (typeof r.pending !== 'boolean') return null
  if (r.role !== null && !isInstanceRole(r.role)) return null
  if (!isStringArray(r.effectivePermissions)) return null
  if (!isStringArray(r.permissionCatalog) || r.permissionCatalog.length === 0) return null
  const out: AuthzMe = {
    enforce: r.enforce,
    pending: r.pending,
    role: r.role,
    effectivePermissions: r.effectivePermissions,
    permissionCatalog: r.permissionCatalog,
  }
  if (r.trainingCompleted !== undefined) {
    if (typeof r.trainingCompleted !== 'boolean') return null
    out.trainingCompleted = r.trainingCompleted
  }
  if (r.requireTraining !== undefined) {
    if (typeof r.requireTraining !== 'boolean') return null
    out.requireTraining = r.requireTraining
  }
  return out
}
