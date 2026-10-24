import type { SessionUser } from './session.js'
import { can } from './principal.js'
import { env } from './env.js'
import { ALL_INSTANCE_PERMISSIONS, parseUserKey, userKey, type InstancePermission, type UserKey } from './authzTypes.js'
import { matchesBootstrap, readInstance, writeInstance } from './authzStoreFiles.js'

/** Effective enforce: always on in production; else env override, else store flag. */
export function isAuthzEnforce(): boolean {
  if (process.env.NODE_ENV === 'production') return true
  if (env.authzEnforce === 'true') return true
  if (env.authzEnforce === 'false') return false
  return readInstance().enforce
}

export function setAuthzEnforce(enforce: boolean): void {
  const s = readInstance()
  s.enforce = enforce
  writeInstance(s)
}

export function isInstanceAdmin(user: UserKey): boolean {
  if (!can(user, 'canBeAdmin')) return false
  return readInstance().admins.includes(userKey(user))
}

export function listInstanceAdmins(): UserKey[] {
  return readInstance().admins.map(parseUserKey)
}

export function instancePermissions(user: UserKey): InstancePermission[] {
  if (isInstanceAdmin(user)) {
    return [...ALL_INSTANCE_PERMISSIONS]
  }
  return readInstance().permissions[userKey(user)] ?? []
}

export function hasInstancePermission(
  user: UserKey,
  perm: InstancePermission,
): boolean {
  return instancePermissions(user).includes(perm)
}

/**
 * Bootstrap instance admin when store has zero admins and user matches
 * AUTHZ_BOOTSTRAP_ADMINS. Enables enforce when env does not force false.
 */
export function maybeBootstrapInstanceAdmin(user: SessionUser): boolean {
  const s = readInstance()
  if (s.admins.length > 0) return false
  if (!matchesBootstrap(user)) return false
  s.admins.push(userKey(user))
  if (env.authzEnforce !== 'false') s.enforce = true
  writeInstance(s)
  return true
}

/**
 * When AUTHZ_DEV_GRANT_ALL is enabled, grant instance admin to every
 * authenticated user (keeps local/e2e usable with enforce on).
 */
export function maybeDevGrantAll(user: SessionUser): void {
  if (!env.authzDevGrantAll) return
  const s = readInstance()
  const key = userKey(user)
  if (s.admins.includes(key)) return
  s.admins.push(key)
  writeInstance(s)
}

export function addInstanceAdmin(actor: UserKey, target: UserKey): { ok: true } | { ok: false; error: string } {
  if (!isInstanceAdmin(actor)) return { ok: false, error: 'Forbidden' }
  if (!can(target, 'canBeAdmin')) return { ok: false, error: 'A service principal cannot be an instance admin' }
  const s = readInstance()
  const key = userKey(target)
  if (!s.admins.includes(key)) s.admins.push(key)
  writeInstance(s)
  return { ok: true }
}

export function removeInstanceAdmin(
  actor: UserKey,
  target: UserKey,
): { ok: true } | { ok: false; error: string } {
  if (!isInstanceAdmin(actor)) return { ok: false, error: 'Forbidden' }
  const s = readInstance()
  if (s.admins.length <= 1 && s.admins.includes(userKey(target))) {
    return { ok: false, error: 'Cannot remove the last instance admin' }
  }
  s.admins = s.admins.filter((k) => k !== userKey(target))
  writeInstance(s)
  return { ok: true }
}

export function setInstancePermissions(
  actor: UserKey,
  target: UserKey,
  perms: InstancePermission[],
): { ok: true } | { ok: false; error: string } {
  if (!isInstanceAdmin(actor)) return { ok: false, error: 'Forbidden' }
  for (const p of perms) {
    if (!ALL_INSTANCE_PERMISSIONS.includes(p)) {
      return { ok: false, error: `Invalid instance permission: ${p}` }
    }
  }
  writeInstancePermissions(target, perms)
  return { ok: true }
}

/** Internal / bootstrap: set instance permissions without actor check. */
export function writeInstancePermissions(
  target: UserKey,
  perms: InstancePermission[],
): void {
  const s = readInstance()
  const key = userKey(target)
  const cleaned = [
    ...new Set(perms.filter((p) => ALL_INSTANCE_PERMISSIONS.includes(p))),
  ]
  if (cleaned.length === 0) delete s.permissions[key]
  else s.permissions[key] = cleaned
  writeInstance(s)
}

/** Users who completed training (Phase 3 gate). */
export function hasCompletedTraining(user: UserKey): boolean {
  const s = readInstance()
  return (s.training ?? []).includes(userKey(user))
}

export function setTrainingCompleted(
  actor: UserKey,
  target: UserKey,
  done: boolean,
): { ok: true } | { ok: false; error: string } {
  if (!isInstanceAdmin(actor)) return { ok: false, error: 'Forbidden' }
  writeTraining(target, done)
  return { ok: true }
}

/** Self-serve training completion (Phase 3). */
export function setTrainingCompletedSelf(user: UserKey, done: boolean): void {
  writeTraining(user, done)
}

function writeTraining(target: UserKey, done: boolean): void {
  const s = readInstance()
  const set = new Set(s.training ?? [])
  if (done) set.add(userKey(target))
  else set.delete(userKey(target))
  s.training = [...set]
  writeInstance(s)
}

export function listInstancePermissionGrants(): Array<{
  sub: string
  iss: string
  permissions: InstancePermission[]
}> {
  return Object.entries(readInstance().permissions).map(([key, permissions]) => {
    const u = parseUserKey(key)
    return { sub: u.sub, iss: u.iss, permissions }
  })
}
