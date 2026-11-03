import { revokeExpiredInstancePermissions } from './authzInstanceStore.js'

const dayMs = 24 * 60 * 60 * 1000

export type InstancePermissionExpiryAudit = (event: {
  action: string
  message: string
  detail: Record<string, unknown>
}) => Promise<void>

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
    const at = now()
    const revoked = await revokeExpiredInstancePermissions(at)
    if (revoked.length === 0) return false
    if (opts.audit) {
      for (const grant of revoked) {
        await opts.audit({
          action: 'instance.permissions.expire',
          message: `Expired instance permissions for ${grant.sub}`,
          detail: {
            target: { sub: grant.sub, iss: grant.iss },
            permissions: grant.permissions,
            expiresAt: grant.expiresAt,
          },
        })
      }
    }
    return true
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
