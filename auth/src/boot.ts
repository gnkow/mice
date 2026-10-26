import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { closeMainDatabase, openMainDatabase } from './db/database.js'
import { initAudit, setAuditObserver, startAuditVerifySchedule } from './audit.js'
import { acquireDataDirLock } from './dataDirLock.js'
import { assertProductionStartup, setAuthenticationObserver, startDirectorySyncSchedule, startServicePatExpirySchedule } from './authentication/index.js'
import { env, oidcConfigured } from './env.js'
import { purgeFavoritesForAudit } from './favoritesStore.js'
import { resumeQueuedJobs } from './jobs.js'
import { captureNotificationAudit, rememberNotificationUser, startNotificationWorker } from './notifications.js'
import { resumeInterruptedProvisions, startSessionsLifecycleSweeper } from './sessions.js'
import { attachSessionsGuacGateway } from './sessionsGateway.js'
import { startSessionLeaseRenewer } from './sessionsWorkspaces.js'
import { startWorkspaceBackground } from './workspaces/routes.js'

/**
 * Starts the BFF: startup gate, data-directory lock, schedules, observers, the
 * app, background workers and the listener. In that order; `createApp` itself has no effects.
 */
export async function boot(): Promise<void> {
  assertProductionStartup()
  if (process.env.NODE_ENV === 'production') {
    const dataLock = acquireDataDirLock(env.dataDir)
    process.on('exit', () => dataLock.release())
  }

  // PostgreSQL: applies the baseline on a blank database and refuses an unexpected schema version.
  await openMainDatabase()

  // Connects to immudb (creating the audit database on first use) and verifies the trail.
  const verification = await initAudit()
  if (!verification.ok) console.error('[mice-auth] audit verification FAILED at boot', verification.firstBreak)
  startAuditVerifySchedule()
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.once(sig, () => {
      void closeMainDatabase().finally(() => process.exit(0))
    })
  }

  startDirectorySyncSchedule()
  await startServicePatExpirySchedule()

  setAuditObserver((event) => {
    purgeFavoritesForAudit(event).catch((err) => console.error('[mice-auth] favorites purge failed', err))
    captureNotificationAudit(event).catch((err) => console.error('[mice-auth] notification capture failed', err))
  })
  setAuthenticationObserver((user) => {
    rememberNotificationUser(user).catch((err) => console.error('[mice-auth] notification user remember failed', err))
  })

  const app = createApp()

  startNotificationWorker()
  resumeQueuedJobs().catch((e: unknown) => console.error('[mice-auth] resume queued jobs failed', e))
  void startWorkspaceBackground()
  startSessionsLifecycleSweeper()
  startSessionLeaseRenewer()
  resumeInterruptedProvisions().catch((e: unknown) => console.error('[mice-auth] resume provisions failed', e))

  console.log(
    `[mice-auth] listening on :${env.port} → oxen ${env.oxenUpstream}` +
      ` (oidc=${oidcConfigured()}; jobs=${env.jobsRunner}; sessions=${env.sessionsEnabled})`,
  )

  const server = serve({ fetch: app.fetch, port: env.port })
  attachSessionsGuacGateway(server as never)
}
