import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { setAuditObserver } from './audit.js'
import { acquireDataDirLock } from './dataDirLock.js'
import { startDirectorySyncSchedule } from './directorySync.js'
import { env, oidcConfigured } from './env.js'
import { purgeFavoritesForAudit } from './favoritesStore.js'
import { runIdentityMigration } from './identityMigration.js'
import { migrateMetaStore } from './metaStore.js'
import { resumeQueuedJobs } from './jobs.js'
import { captureNotificationAudit, rememberNotificationUser, startNotificationWorker } from './notifications.js'
import { setAuthenticationObserver } from './requireAuth.js'
import { startServicePatExpirySchedule } from './servicePrincipalExpiry.js'
import { resumeInterruptedProvisions, startSessionsLifecycleSweeper } from './sessions.js'
import { attachSessionsGuacGateway } from './sessionsGateway.js'
import { startSessionLeaseRenewer } from './sessionsWorkspaces.js'
import { assertProductionStartup } from './startupGate.js'
import { startWorkspaceBackground } from './workspaces/routes.js'

/**
 * Starts the BFF: startup gate, data-directory lock, migrations, schedules, observers, the
 * app, background workers and the listener. In that order; `createApp` itself has no effects.
 */
export function boot(): void {
  assertProductionStartup()
  if (process.env.NODE_ENV === 'production') {
    const dataLock = acquireDataDirLock(env.dataDir)
    process.on('exit', () => dataLock.release())
    for (const sig of ['SIGINT', 'SIGTERM'] as const) {
      process.once(sig, () => process.exit(0))
    }
  }

  runIdentityMigration()
  migrateMetaStore()
  startDirectorySyncSchedule()
  startServicePatExpirySchedule()

  setAuditObserver((event) => {
    try { purgeFavoritesForAudit(event) } catch (err) { console.error('[mice-auth] favorites purge failed', err) }
    captureNotificationAudit(event)
  })
  setAuthenticationObserver(rememberNotificationUser)

  const app = createApp()

  startNotificationWorker()
  resumeQueuedJobs()
  void startWorkspaceBackground()
  startSessionsLifecycleSweeper()
  startSessionLeaseRenewer()
  resumeInterruptedProvisions()

  console.log(
    `[mice-auth] listening on :${env.port} → oxen ${env.oxenUpstream}` +
      ` (oidc=${oidcConfigured()}; jobs=${env.jobsRunner}; sessions=${env.sessionsEnabled})`,
  )

  const server = serve({ fetch: app.fetch, port: env.port })
  attachSessionsGuacGateway(server as never)
}
