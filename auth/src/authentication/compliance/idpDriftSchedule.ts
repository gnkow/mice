/**
 * Scheduled job for daily IdP drift detection (Ticket 23)
 * and Principal access monitoring (Ticket 11)
 */

import { performDriftCheck } from './idpDriftDetection.js'
import { runDisabledPrincipalCheck } from './principalAccessMonitoring.js'

const ONE_DAY_MS = 24 * 60 * 60 * 1000

/**
 * Start the daily IdP drift detection schedule.
 * Runs once per day to check for configuration drift and access issues.
 */
export function startIdpDriftSchedule(
  opts: { intervalMs?: number; poll?: boolean } = {}
): { tick(): Promise<boolean>; stop(): void } {
  const intervalMs = opts.intervalMs ?? ONE_DAY_MS
  let last = Date.now()

  const tick = async (): Promise<boolean> => {
    if (Date.now() - last < intervalMs) return false
    last = Date.now()

    try {
      // Ticket 23: Check IdP configuration drift
      const report = await performDriftCheck()

      if (report.hasCriticalDrift) {
        console.error(
          '[mice-auth] CRITICAL IdP DRIFT DETECTED:',
          report.criticalDrifts.join('; ')
        )
        // In production, this would also send alerts via email/Slack
      } else if (report.hasNonCriticalDrift) {
        console.warn(
          '[mice-auth] Non-critical IdP drift detected:',
          report.nonCriticalDrifts.join('; ')
        )
      } else {
        console.log('[mice-auth] IdP drift check: no drift detected')
      }

      // Ticket 11: Check for disabled Principals with signing rights
      const accessCheck = await runDisabledPrincipalCheck()
      if (accessCheck.alarmsFound > 0) {
        console.error(
          `[mice-auth] CRITICAL ACCESS ALARM: ${accessCheck.alarmsFound} disabled Principal(s) with signing rights`
        )
        // In production, this would trigger immediate alerts
      }

      return true
    } catch (err) {
      console.error(
        '[mice-auth] IdP drift/access check failed:',
        err instanceof Error ? err.message : 'unknown error'
      )
      return false
    }
  }

  const timer =
    opts.poll === false
      ? undefined
      : setInterval(() => void tick(), Math.min(intervalMs, 60_000))
  timer?.unref()

  return { tick, stop: () => clearInterval(timer) }
}
