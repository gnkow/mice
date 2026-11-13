import { profileRoleBadge } from './profileRoleBadge'

export const APPROVABLE_BY_MANAGER = ['external', 'user', 'manager'] as const
export const APPROVABLE_BY_ADMIN = [
  'external',
  'user',
  'manager',
  'auditor',
  'admin',
] as const

export type AccessRequestStatusFilter = 'pending' | 'approved' | 'denied' | 'all'

export type AccessRequestListItem = {
  id: string
  status: string
  requestedRole?: string | null
  requestedPermissions?: string[]
  message?: string
  name?: string
  email?: string
  createdAt?: string
}

/** Client-side status filter for Settings → Access Requests. */
export function filterAccessRequests<T extends { status: string }>(
  rows: readonly T[],
  filter: AccessRequestStatusFilter,
): T[] {
  if (filter === 'all') return [...rows]
  return rows.filter((r) => r.status === filter)
}

/** One-line summary of what the applicant asked for. */
export function formatRequestedAccess(input: {
  requestedRole?: string | null
  requestedPermissions?: readonly string[]
}): string {
  const role =
    input.requestedRole != null
      ? profileRoleBadge({ role: input.requestedRole, pending: false })
      : null
  const perms = (input.requestedPermissions ?? []).filter(Boolean)
  if (role && perms.length > 0) return `${role} + ${perms.join(', ')}`
  if (role) return role
  if (perms.length > 0) return perms.join(', ')
  return '—'
}

/** Roles the reviewer may assign when modifying before approve. */
export function approvableRoles(reviewerRole: string | null | undefined): string[] {
  if (reviewerRole === 'admin') return [...APPROVABLE_BY_ADMIN]
  if (reviewerRole === 'manager') return [...APPROVABLE_BY_MANAGER]
  return []
}

export type ApproveFormState = {
  expiresAt: number
  grantedRole: string | null
  grantedPermissions: string[]
  reason: string
}

export type ApproveBodyResult =
  | {
      ok: true
      body: {
        action: 'approve'
        expiresAt: number
        grantedRole: string | null
        grantedPermissions: string[]
        reason?: string
      }
    }
  | { ok: false; error: string }

/** Validate approve form → POST /auth/access-requests/:id body. */
export function buildApproveBody(state: ApproveFormState): ApproveBodyResult {
  if (!Number.isFinite(state.expiresAt) || state.expiresAt <= 0) {
    return { ok: false, error: 'Expiry is required' }
  }
  if (state.grantedRole == null && state.grantedPermissions.length === 0) {
    return { ok: false, error: 'Choose a role or at least one permission to grant' }
  }
  const reason = state.reason.trim()
  return {
    ok: true,
    body: {
      action: 'approve',
      expiresAt: state.expiresAt,
      grantedRole: state.grantedRole,
      grantedPermissions: [...new Set(state.grantedPermissions.filter(Boolean))],
      ...(reason ? { reason } : {}),
    },
  }
}

export type DenyBodyResult =
  | { ok: true; body: { action: 'deny'; reason: string } }
  | { ok: false; error: string }

/** Validate deny form → POST body (reason required). */
export function buildDenyBody(input: { reason: string }): DenyBodyResult {
  const reason = input.reason.trim()
  if (!reason) return { ok: false, error: 'Denial reason is required' }
  return { ok: true, body: { action: 'deny', reason } }
}

/** True when the API rejected because the reviewer lacks authority. */
export function isAuthorityError(message: string): boolean {
  const m = message.toLowerCase()
  return (
    m.includes('insufficient approval authority') ||
    m.includes('insufficient authority') ||
    m.includes('forbidden')
  )
}

/** True when demoting/removing an Admin would leave fewer than two instance admins (ADR 0007). */
export function isAdminFloorError(message: string): boolean {
  const m = message.toLowerCase()
  return m.includes('at least two') && m.includes('admin')
}
