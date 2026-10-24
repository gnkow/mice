import type { SessionUser } from './session.js'
import { can } from './principal.js'
import { env } from './env.js'
import { ALL_INSTANCE_PERMISSIONS, parseUserKey, userKey, type InstancePermission, type UserKey } from './authzTypes.js'
import { instanceSnapshot, matchesBootstrap, updateInstance } from './authzRepository.js'

/** Effective enforce: always on in production; else env override, else store flag. */
export function isAuthzEnforce(): boolean {
  if (process.env.NODE_ENV === 'production') return true
  if (env.authzEnforce === 'true') return true
  if (env.authzEnforce === 'false') return false
  return instanceSnapshot().enforce
}

export function setAuthzEnforce(enforce: boolean): void {
  updateInstance((s) => {
    s.enforce = enforce
  })
}

export function isInstanceAdmin(user: UserKey): boolean {
  if (!can(user, 'canBeAdmin')) return false
  return instanceSnapshot().admins.includes(userKey(user))
}

export function listInstanceAdmins(): UserKey[] {
  return instanceSnapshot().admins.map(parseUserKey)
}

export function instancePermissions(user: UserKey): InstancePermission[] {
  if (isInstanceAdmin(user)) {
    return [...ALL_INSTANCE_PERMISSIONS]
  }
  return instanceSnapshot().permissions[userKey(user)] ?? []
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
  if (instanceSnapshot().admins.length > 0) return false
  if (!matchesBootstrap(user)) return false
  updateInstance((s) => {
    s.admins.push(userKey(user))
    if (env.authzEnforce !== 'false') s.enforce = true
  })
  return true
}

/**
 * When AUTHZ_DEV_GRANT_ALL is enabled, grant instance admin to every
 * authenticated user (keeps local/e2e usable with enforce on).
 */
export function maybeDevGrantAll(user: SessionUser): void {
  if (!env.authzDevGrantAll) return
  const key = userKey(user)
  if (instanceSnapshot().admins.includes(key)) return
  updateInstance((s) => {
    s.admins.push(key)
  })
}

export function addInstanceAdmin(actor: UserKey, target: UserKey): { ok: true } | { ok: false; error: string } {
  if (!isInstanceAdmin(actor)) return { ok: false, error: 'Forbidden' }
  if (!can(target, 'canBeAdmin')) return { ok: false, error: 'A service principal cannot be an instance admin' }
  const key = userKey(target)
  updateInstance((s) => {
    if (!s.admins.includes(key)) s.admins.push(key)
  })
  return { ok: true }
}

export function removeInstanceAdmin(
  actor: UserKey,
  target: UserKey,
): { ok: true } | { ok: false; error: string } {
  if (!isInstanceAdmin(actor)) return { ok: false, error: 'Forbidden' }
  const { admins } = instanceSnapshot()
  if (admins.length <= 1 && admins.includes(userKey(target))) {
    return { ok: false, error: 'Cannot remove the last instance admin' }
  }
  updateInstance((s) => {
    s.admins = s.admins.filter((k) => k !== userKey(target))
  })
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
  const key = userKey(target)
  const cleaned = [
    ...new Set(perms.filter((p) => ALL_INSTANCE_PERMISSIONS.includes(p))),
  ]
  updateInstance((s) => {
    if (cleaned.length === 0) delete s.permissions[key]
    else s.permissions[key] = cleaned
  })
}

/** Users who completed training (Phase 3 gate). */
export function hasCompletedTraining(user: UserKey): boolean {
  return (instanceSnapshot().training ?? []).includes(userKey(user))
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
  updateInstance((s) => {
    const set = new Set(s.training ?? [])
    if (done) set.add(userKey(target))
    else set.delete(userKey(target))
    s.training = [...set]
  })
}

export function listInstancePermissionGrants(): Array<{
  sub: string
  iss: string
  permissions: InstancePermission[]
}> {
  return Object.entries(instanceSnapshot().permissions).map(([key, permissions]) => {
    const u = parseUserKey(key)
    return { sub: u.sub, iss: u.iss, permissions }
  })
}
