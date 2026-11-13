import { can, type SessionUser } from './authentication/index.js'
import { ALL_INSTANCE_PERMISSIONS, parseUserKey, userKey, type InstancePermission, type UserKey } from './authzTypes.js'
import * as repo from './authzRepository.js'
import { assignRole, getUserRole, listAdminPrincipals } from './rbacStore.js'
import { matchesBootstrap } from './authzRepository.js'

type Result = { ok: true } | { ok: false; error: string }

/** Far-future default for internal/seed writes that are not admin-delegated grants. */
const INTERNAL_GRANT_EXPIRY = new Date('9999-12-31T00:00:00.000Z')

function toExpiryDate(expiresAt: Date | number): Date {
  return expiresAt instanceof Date ? expiresAt : new Date(expiresAt)
}

/**
 * Pure Admin-role-only decision: no boolean flag, no delegated permissions.
 * `isInstanceAdmin` loads role + capability then calls this seam.
 */
export function decideIsInstanceAdmin(input: {
  role: string | null
  canBeAdmin: boolean
}): boolean {
  return input.canBeAdmin && input.role === 'admin'
}

/** Instance admin is the Admin role; there is no separate flag. */
export async function isInstanceAdmin(user: UserKey): Promise<boolean> {
  return decideIsInstanceAdmin({
    canBeAdmin: can(user, 'canBeAdmin'),
    role: await getUserRole(user),
  })
}

export async function listInstanceAdmins(): Promise<UserKey[]> {
  return listAdminPrincipals()
}

export async function instancePermissions(user: UserKey, now = Date.now()): Promise<InstancePermission[]> {
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
 * Gives the Admin role to a Principal on the `AUTHZ_BOOTSTRAP_ADMINS` list.
 * Every allowlisted Principal is granted, so an existing admin does not block the rest of the list.
 */
export async function maybeBootstrapInstanceAdmin(user: SessionUser): Promise<boolean> {
  if (!matchesBootstrap(user)) return false
  if ((await getUserRole(user)) === 'admin') return true
  await assignRole({ actor: null, target: user, role: 'admin', reason: 'bootstrap', bootstrap: true })
  return true
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
