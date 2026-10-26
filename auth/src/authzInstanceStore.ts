import type { SessionUser } from './authentication/session/session.js'
import { can } from './authentication/session/principal.js'
import { env } from './env.js'
import { ALL_INSTANCE_PERMISSIONS, parseUserKey, userKey, type InstancePermission, type UserKey } from './authzTypes.js'
import * as repo from './authzRepository.js'
import { matchesBootstrap } from './authzRepository.js'

type Result = { ok: true } | { ok: false; error: string }

/** Effective enforce: always on in production; else env override, else store flag. */
export async function isAuthzEnforce(): Promise<boolean> {
  if (process.env.NODE_ENV === 'production') return true
  if (env.authzEnforce === 'true') return true
  if (env.authzEnforce === 'false') return false
  return repo.storedEnforce()
}

export async function setAuthzEnforce(enforce: boolean): Promise<void> {
  await repo.writeEnforce(enforce)
}

export async function isInstanceAdmin(user: UserKey): Promise<boolean> {
  if (!can(user, 'canBeAdmin')) return false
  return repo.isAdminKey(userKey(user))
}

export async function listInstanceAdmins(): Promise<UserKey[]> {
  return (await repo.listAdminKeys()).map(parseUserKey)
}

export async function instancePermissions(user: UserKey): Promise<InstancePermission[]> {
  if (await isInstanceAdmin(user)) return [...ALL_INSTANCE_PERMISSIONS]
  return repo.instancePermissionsOf(userKey(user))
}

export async function hasInstancePermission(user: UserKey, perm: InstancePermission): Promise<boolean> {
  return (await instancePermissions(user)).includes(perm)
}

/**
 * Bootstrap instance admin when the store has zero admins and the user matches
 * AUTHZ_BOOTSTRAP_ADMINS. Enables enforce when env does not force false.
 */
export async function maybeBootstrapInstanceAdmin(user: SessionUser): Promise<boolean> {
  if (!matchesBootstrap(user)) return false
  return repo.bootstrapFirstAdmin(userKey(user), env.authzEnforce !== 'false')
}

/** When AUTHZ_DEV_GRANT_ALL is enabled, grant instance admin to every authenticated user. */
export async function maybeDevGrantAll(user: SessionUser): Promise<void> {
  if (!env.authzDevGrantAll) return
  const key = userKey(user)
  if (await repo.isAdminKey(key)) return
  await repo.addAdminKey(key)
}

export async function addInstanceAdmin(actor: UserKey, target: UserKey): Promise<Result> {
  if (!(await isInstanceAdmin(actor))) return { ok: false, error: 'Forbidden' }
  if (!can(target, 'canBeAdmin')) return { ok: false, error: 'A service principal cannot be an instance admin' }
  await repo.addAdminKey(userKey(target))
  return { ok: true }
}

export async function removeInstanceAdmin(actor: UserKey, target: UserKey): Promise<Result> {
  if (!(await isInstanceAdmin(actor))) return { ok: false, error: 'Forbidden' }
  const key = userKey(target)
  if (!(await repo.removeAdminKey(key))) return { ok: false, error: 'Cannot remove the last instance admin' }
  return { ok: true }
}

export async function setInstancePermissions(
  actor: UserKey,
  target: UserKey,
  perms: InstancePermission[],
): Promise<Result> {
  if (!(await isInstanceAdmin(actor))) return { ok: false, error: 'Forbidden' }
  for (const p of perms) {
    if (!ALL_INSTANCE_PERMISSIONS.includes(p)) {
      return { ok: false, error: `Invalid instance permission: ${p}` }
    }
  }
  await writeInstancePermissions(target, perms)
  return { ok: true }
}

/** Internal / bootstrap: set instance permissions without actor check. */
export async function writeInstancePermissions(target: UserKey, perms: InstancePermission[]): Promise<void> {
  const cleaned = [...new Set(perms.filter((p) => ALL_INSTANCE_PERMISSIONS.includes(p)))]
  await repo.replaceInstancePermissions(userKey(target), cleaned)
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
  Array<{ sub: string; iss: string; permissions: InstancePermission[] }>
> {
  return (await repo.listInstancePermissionRows()).map(({ key, permissions }) => {
    const u = parseUserKey(key)
    return { sub: u.sub, iss: u.iss, permissions }
  })
}
