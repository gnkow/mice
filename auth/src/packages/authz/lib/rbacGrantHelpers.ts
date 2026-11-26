import type { SessionUser } from '../../authentication/principal.js'
import type { AuditDep } from '../../shared/index.js'
import { directGrantPermissions, directGrantRole } from './rbacDirectGrant.js'
import { isInstancePermission } from './rbacCatalog.js'
import { isInstanceRole } from './rbacRoles.js'
import { getPermissionAuditSnapshot, getRoleAuditSnapshot } from './rbacStore.js'
import { requireAuditChange } from '../../audit/change.js'
import { captureBefore } from '../../audit/change.js'

type GrantTarget = { sub: string; iss: string }

export function parseGrantTarget(body: Record<string, unknown>): GrantTarget | null {
  if (typeof body.sub !== 'string' || typeof body.iss !== 'string') return null
  return { sub: body.sub, iss: body.iss }
}

export function parseGrantExpiresAt(body: Record<string, unknown>): number | null {
  if (typeof body.expiresAt === 'number' && Number.isFinite(body.expiresAt)) return body.expiresAt
  if (typeof body.expiresAt === 'string') {
    const n = Date.parse(body.expiresAt)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** Prefer the signed ceremony reason; fall back to body or a short default. */
export function grantReason(
  c: { req: { header: (name: string) => string | undefined } },
  body: Record<string, unknown>,
): string {
  const signed = (c.req.header('x-mice-reason') ?? '').trim()
  if (signed) return signed
  return typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : 'Direct grant'
}

type AuditFn = AuditDep['audit']
type Ctx = Parameters<AuditFn>[0]

export type GrantOrchestrationResult =
  | { ok: true; body: { ok: true } }
  | { ok: false; status: 400 | 403; body: { error: string } }

/** Validate + grant a role, writing success/denial audit around the mutation. */
export async function orchestrateRoleGrant(input: {
  c: Ctx
  user: SessionUser
  body: Record<string, unknown>
  audit: AuditFn
}): Promise<GrantOrchestrationResult> {
  const { c, user, body, audit } = input
  const t = parseGrantTarget(body)
  if (!t) return { ok: false, status: 400, body: { error: 'sub and iss required' } }
  if (!isInstanceRole(body.role)) {
    return { ok: false, status: 400, body: { error: `Invalid role: ${String(body.role)}` } }
  }
  const expiresAt = parseGrantExpiresAt(body)
  if (expiresAt == null) {
    return { ok: false, status: 400, body: { error: 'expiresAt is required for delegated role grants' } }
  }
  const beforeSeat = await captureBefore(() => getRoleAuditSnapshot(t))
  const result = await directGrantRole({
    actor: user,
    target: t,
    role: body.role,
    reason: grantReason(c, body),
    expiresAt,
  })
  if (!result.ok) {
    const status = result.error.startsWith('Forbidden') ? 403 : 400
    await audit(c, user, 'session', {
      action: 'access.grant.role',
      status,
      message: `Direct role grant denied: ${result.error}`,
      detail: { target: t, role: body.role },
    })
    return { ok: false, status, body: { error: result.error } }
  }
  const afterSeat = await getRoleAuditSnapshot(t)
  await audit(c, user, 'session', {
    action: 'access.grant.role',
    change: requireAuditChange(beforeSeat, afterSeat),
    message: `Granted role ${body.role} to ${t.sub}`,
    detail: { target: t, role: body.role, expiresAt },
  })
  return { ok: true, body: { ok: true } }
}

/** Validate + grant custom permissions, writing success/denial audit around the mutation. */
export async function orchestratePermissionGrant(input: {
  c: Ctx
  user: SessionUser
  body: Record<string, unknown>
  audit: AuditFn
}): Promise<GrantOrchestrationResult> {
  const { c, user, body, audit } = input
  const t = parseGrantTarget(body)
  if (!t) return { ok: false, status: 400, body: { error: 'sub and iss required' } }
  if (!Array.isArray(body.permissions)) {
    return { ok: false, status: 400, body: { error: 'permissions must be an array' } }
  }
  const permissions: string[] = []
  for (const p of body.permissions) {
    if (typeof p !== 'string' || !isInstancePermission(p)) {
      return { ok: false, status: 400, body: { error: `Invalid permission: ${String(p)}` } }
    }
    permissions.push(p)
  }
  const expiresAt = parseGrantExpiresAt(body)
  if (expiresAt == null) {
    return {
      ok: false,
      status: 400,
      body: { error: 'expiresAt is required for delegated permission grants' },
    }
  }
  const beforePerms = await captureBefore(() => getPermissionAuditSnapshot(t, permissions))
  const result = await directGrantPermissions({
    actor: user,
    target: t,
    permissions,
    reason: grantReason(c, body),
    expiresAt,
  })
  if (!result.ok) {
    const status = result.error.startsWith('Forbidden') ? 403 : 400
    await audit(c, user, 'session', {
      action: 'access.grant.permissions',
      status,
      message: `Direct permission grant denied: ${result.error}`,
      detail: { target: t, permissions },
    })
    return { ok: false, status, body: { error: result.error } }
  }
  const afterPerms = await getPermissionAuditSnapshot(t, permissions)
  await audit(c, user, 'session', {
    action: 'access.grant.permissions',
    change: requireAuditChange(beforePerms, afterPerms),
    message: `Granted permissions to ${t.sub}`,
    detail: { target: t, permissions, expiresAt },
  })
  return { ok: true, body: { ok: true } }
}
