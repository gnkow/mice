import { closeAuditOutage, reportAuditDegradation } from './auditOutage.js'
import { systemClock, type Clock } from '../../shared/index.js'
import { env } from '../../shared/index.js'
import { verifyAudit } from './auditVerify.js'

/**
 * Re-verifies when `intervalMs` has elapsed on the clock. `tick()` returns whether it verified;
 * with `poll` (default) a timer calls it every `min(intervalMs, 60s)`.
 */
export function startAuditVerifySchedule(
  opts: {
    clock?: Clock
    intervalMs?: number
    poll?: boolean
    /** Extra work after each verify tick (e.g. orphan-aging alert). */
    afterTick?: () => void | Promise<void>
  } = {},
): { tick(): Promise<boolean>; stop(): void } {
  const clock = opts.clock ?? systemClock
  const intervalMs = opts.intervalMs ?? env.auditVerifyIntervalSec * 1000
  let last = clock.now()
  const tick = async (): Promise<boolean> => {
    if (clock.now() - last < intervalMs) return false
    last = clock.now()
    const v = await verifyAudit()
    if (!v.ok) {
      console.error('[mice-auth] audit verification FAILED', v.firstBreak)
      void reportAuditDegradation({
        at: clock.now(),
        check: 'verify',
        requestId: 'verify',
        detail: v.firstBreak?.reason,
      }).catch((err) => console.error('[mice-auth] audit outage report failed', err))
    } else {
      void closeAuditOutage(clock.now()).catch((err) =>
        console.error('[mice-auth] audit outage close failed', err),
      )
    }
    if (opts.afterTick) {
      try {
        await opts.afterTick()
      } catch (err) {
        console.error('[mice-auth] audit schedule afterTick failed', err)
      }
    }
    return true
  }
  const timer = opts.poll === false ? undefined : setInterval(() => void tick(), Math.min(intervalMs, 60_000))
  timer?.unref()
  return { tick, stop: () => clearInterval(timer) }
}
