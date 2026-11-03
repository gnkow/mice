import { can, type SessionUser } from './authentication/index.js'
import { ALL_INSTANCE_PERMISSIONS, parseUserKey, userKey, type InstancePermission, type UserKey } from './authzTypes.js'
import * as repo from './authzRepository.js'
import { matchesBootstrap } from './authzRepository.js'

type Result = { ok: true } | { ok: false; error: string }

/** Far-future default for internal/seed writes that are not admin-delegated grants. */
const INTERNAL_GRANT_EXPIRY = new Date('9999-12-31T00:00:00.000Z')

function toExpiryDate(expiresAt: Date | number): Date {
  return expiresAt instanceof Date ? expiresAt : new Date(expiresAt)
}

export async function isInstanceAdmin(user: UserKey): Promise<boolean> {
  if (!can(user, 'canBeAdmin')) return false
  return repo.isAdminKey(userKey(user))
}

export async function listInstanceAdmins(): Promise<UserKey[]> {
  return (await repo.listAdminKeys()).map(parseUserKey)
}

export async function instancePermissions(user: UserKey, now = Date.now()): Promise<InstancePermission[]> {
  if (await isInstanceAdmin(user)) return [...ALL_INSTANCE_PERMISSIONS]
  return repo.instancePermissionsOf(userKey(user), now)
}

export async function hasInstancePermission(
  user: UserKey,
  perm: InstancePermission,
  now = Date.now(),
): Promise<boolean> {
  return (await instancePermissions(user, now)).includes(perm)
}

/**
 * Grants instance admin to a Principal on the `AUTHZ_BOOTSTRAP_ADMINS` list.
 * Later allowlisted Principals are granted too, so an existing admin does not
 * block the rest of the list.
 */
export async function maybeBootstrapInstanceAdmin(user: SessionUser): Promise<boolean> {
  if (!matchesBootstrap(user)) return false
  const key = userKey(user)
  if (await repo.isAdminKey(key)) return true
  const first = await repo.bootstrapFirstAdmin(key)
  if (first) return true
  await repo.addAdminKey(key)
  return true
}

export async function addInstanceAdmin(actor: UserKey, target: UserKey): Promise<Result> {
  if (!(await isInstanceAdmin(actor))) return { ok: false, error: 'Forbidden' }
  if (!can(target, 'canBeAdmin')) return { ok: false, error: 'Forbidden' }
  await repo.addAdminKey(userKey(target))
  return { ok: true }
}

export async function removeInstanceAdmin(actor: UserKey, target: UserKey): Promise<Result> {
  if (!(await isInstanceAdmin(actor))) return { ok: false, error: 'Forbidden' }
  const key = userKey(target)
  if (!(await repo.removeAdminKey(key))) return { ok: false, error: 'At least two instance admins must remain' }
  return { ok: true }
}

/**
 * Admin-delegated instance permissions. Non-empty grants require a future `expiresAt`.
 * Clearing (`perms` empty) does not require expiry.
 */
export async function setInstancePermissions(
  actor: UserKey,
  target: UserKey,
  perms: InstancePermission[],
  expiresAt?: Date | number | null,
): Promise<Result> {
  if (!(await isInstanceAdmin(actor))) return { ok: false, error: 'Forbidden' }
  for (const p of perms) {
    if (!ALL_INSTANCE_PERMISSIONS.includes(p)) {
      return { ok: false, error: `Invalid instance permission: ${p}` }
    }
  }
  if (perms.length > 0) {
    if (expiresAt == null) {
      return { ok: false, error: 'expiresAt is required for delegated instance permissions' }
    }
    const when = typeof expiresAt === 'number' ? expiresAt : expiresAt.getTime()
    if (!Number.isFinite(when) || when <= Date.now()) {
      return { ok: false, error: 'expiresAt must be a future time' }
    }
    await writeInstancePermissions(target, perms, when)
  } else {
    await writeInstancePermissions(target, [])
  }
  return { ok: true }
}

/** Internal / bootstrap: set instance permissions without actor check. */
export async function writeInstancePermissions(
  target: UserKey,
  perms: InstancePermission[],
  expiresAt: Date | number = INTERNAL_GRANT_EXPIRY,
): Promise<void> {
  const cleaned = [...new Set(perms.filter((p) => ALL_INSTANCE_PERMISSIONS.includes(p)))]
  await repo.replaceInstancePermissions(userKey(target), cleaned, toExpiryDate(expiresAt))
}

/** Users who completed training (Phase 3 gate). */
export async function hasCompletedTraining(user: UserKey): Promise<boolean> {
  return repo.isTrained(userKey(user))
}

export async function setTrainingCompleted(actor: UserKey, target: UserKey, done: boolean): Promise<Result> {
  if (!(await isInstanceAdmin(actor))) return { ok: false, error: 'Forbidden' }
  await repo.writeTrained(userKey(target), done)
  return { ok: true }
}

/** Self-serve training completion (Phase 3). */
export async function setTrainingCompletedSelf(user: UserKey, done: boolean): Promise<void> {
  await repo.writeTrained(userKey(user), done)
}

export async function listInstancePermissionGrants(): Promise<
  Array<{ sub: string; iss: string; permissions: InstancePermission[]; expiresAt: number }>
> {
  return (await repo.listInstancePermissionRows()).map(({ key, permissions, expiresAt }) => {
    const u = parseUserKey(key)
    return { sub: u.sub, iss: u.iss, permissions, expiresAt }
  })
}

export type RevokedInstancePermissionGrant = {
  sub: string
  iss: string
  permissions: InstancePermission[]
  expiresAt: number
}

/** Remove instance permission rows that have reached expiresAt. */
export async function revokeExpiredInstancePermissions(
  now = Date.now(),
): Promise<RevokedInstancePermissionGrant[]> {
  const deleted = await repo.deleteExpiredInstancePermissions(now)
  return deleted.map(({ key, permissions, expiresAt }) => {
    const u = parseUserKey(key)
    return { sub: u.sub, iss: u.iss, permissions, expiresAt }
  })
}
