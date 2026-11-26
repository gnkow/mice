import { requireAuditChange } from '../../audit/change.js'
import type { AuditChange } from '../../audit/change.js'
import {
  revokeExpiredInstancePermissions,
  type RevokedInstancePermissionGrant,
} from './authzInstanceStore.js'

export {
  DELEGATED_EXPIRY_MUST_BE_FUTURE,
  DELEGATED_EXPIRY_REQUIRED,
  decideDelegatedInstanceExpiry,
} from './delegatedInstanceExpiry.js'

const dayMs = 24 * 60 * 60 * 1000

export type InstancePermissionExpiryAudit = (event: {
  action: string
  message: string
  detail: Record<string, unknown>
  change: AuditChange
}) => Promise<void>

export type RevokeExpiredInstancePermissions = (
  now: number,
) => Promise<RevokedInstancePermissionGrant[]>

/**
 * Single seam for mandatory instance-permission expiry: revoke grants at/before `now`
 * and optionally audit each revocation. Persistence stays in the instance store;
 * schedule/timer callers only time this function.
 */
export async function runInstancePermissionExpiry(opts: {
  now?: number
  revoke?: RevokeExpiredInstancePermissions
  audit?: InstancePermissionExpiryAudit
} = {}): Promise<RevokedInstancePermissionGrant[]> {
  const at = opts.now ?? Date.now()
  const revoke = opts.revoke ?? revokeExpiredInstancePermissions
  const revoked = await revoke(at)
  if (revoked.length === 0 || !opts.audit) return revoked
  for (const grant of revoked) {
    await opts.audit({
      action: 'instance.permissions.expire',
      // The grant is removed: its permissions and expiry go from set to null.
      change: requireAuditChange(
        {
          ...Object.fromEntries([...grant.permissions].sort().map((p) => [`permission.${p}`, true])),
          expiresAt: grant.expiresAt,
        },
        null,
      ),
      message: `Expired instance permissions for ${grant.sub}`,
      detail: {
        target: { sub: grant.sub, iss: grant.iss },
        permissions: grant.permissions,
        expiresAt: grant.expiresAt,
      },
    })
  }
  return revoked
}

/**
 * Daily job: delete instance permission grants whose expiresAt has passed
 * and optionally audit each revocation.
 */
export function startInstancePermissionExpirySchedule(opts: {
  now?: () => number
  poll?: boolean
  audit?: InstancePermissionExpiryAudit
} = {}) {
  const now = opts.now ?? (() => Date.now())
  const tick = async () => {
    const revoked = await runInstancePermissionExpiry({
      now: now(),
      audit: opts.audit,
    })
    return revoked.length > 0
  }
  const safe = () => {
    void tick().catch((err) =>
      console.error('[mice-auth] instance permission expiry revoke failed', err),
    )
  }
  const timer = opts.poll === false ? undefined : setInterval(safe, dayMs)
  timer?.unref()
  if (opts.poll !== false) safe()
  return { tick, stop: () => clearInterval(timer) }
}
