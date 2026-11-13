/**
 * Scheduled job for daily IdP drift detection (Ticket 23)
 * and Principal access monitoring (Ticket 11)
 */

import { assessDrift, type DriftReport, type IdpDriftFetchDeps } from './idpDriftDetection.js'
import { runDisabledPrincipalCheck } from './principalAccessMonitoring.js'

const ONE_DAY_MS = 24 * 60 * 60 * 1000

export type IdpDriftTickResult = {
  report: DriftReport
  accessAlarmsFound: number
}

/** Log severity for one drift report (schedule / admin runners share this). */
export function logDriftReport(report: DriftReport): void {
  if (report.hasCriticalDrift) {
    console.error(
      '[mice-auth] CRITICAL IdP DRIFT DETECTED:',
      report.criticalDrifts.join('; '),
    )
  } else if (report.hasNonCriticalDrift) {
    console.warn(
      '[mice-auth] Non-critical IdP drift detected:',
      report.nonCriticalDrifts.join('; '),
    )
  } else if (report.error) {
    console.error('[mice-auth] IdP drift check error:', report.error)
  } else {
    console.log('[mice-auth] IdP drift check: no drift detected')
  }
}

/**
 * One daily tick: persist drift assessment, log severity, then disabled-signer alarms.
 */
export async function runIdpDriftTick(
  deps: IdpDriftFetchDeps = {},
): Promise<IdpDriftTickResult> {
  const report = await assessDrift({ ...deps, persist: true })
  logDriftReport(report)

  const accessCheck = await runDisabledPrincipalCheck()
  if (accessCheck.alarmsFound > 0) {
    console.error(
      `[mice-auth] CRITICAL ACCESS ALARM: ${accessCheck.alarmsFound} disabled Principal(s) with signing rights`,
    )
  }

  return { report, accessAlarmsFound: accessCheck.alarmsFound }
}

/**
 * Start the daily IdP drift detection schedule.
 * Runs once per day to check for configuration drift and access issues.
 */
export function startIdpDriftSchedule(
  opts: { intervalMs?: number; poll?: boolean } & IdpDriftFetchDeps = {},
): { tick(): Promise<boolean>; stop(): void } {
  const { intervalMs = ONE_DAY_MS, poll, fetchDiscovery, issuer, now } = opts
  const driftDeps: IdpDriftFetchDeps = { fetchDiscovery, issuer, now }
  let last = Date.now()

  const tick = async (): Promise<boolean> => {
    if (Date.now() - last < intervalMs) return false
    last = Date.now()

    try {
      await runIdpDriftTick(driftDeps)
      return true
    } catch (err) {
      console.error(
        '[mice-auth] IdP drift/access check failed:',
        err instanceof Error ? err.message : 'unknown error',
      )
      return false
    }
  }

  const timer =
    poll === false
      ? undefined
      : setInterval(() => void tick(), Math.min(intervalMs, 60_000))
  timer?.unref()

  return { tick, stop: () => clearInterval(timer) }
}
