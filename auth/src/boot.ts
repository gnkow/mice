import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { dirname, join } from 'node:path'
import { closeDatabase, databasePath, openDatabase } from './jsonStore.js'
import { startDatabaseBackupSchedule } from './dbBackup.js'
import { importLegacyData } from './legacyImport.js'
import { initAudit, initAuditSigning, setAuditObserver, startAuditCheckpointSchedule, startAuditVerifySchedule, writeCheckpoint } from './audit.js'
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
  }

  // Moves pre-database JSON/JSONL files into the database once; a failure throws, so a half-migrated store never serves.
  const imported = importLegacyData(env.dataDir, openDatabase())
  if (imported.imported) {
    console.log(`[mice-auth] imported legacy data: ${imported.documents} documents, ${imported.logs} logs (${imported.rows} rows); originals archived in legacy-import/`)
    if (imported.partialLines.length) console.warn('[mice-auth] dropped unterminated trailing lines in', imported.partialLines.join(', '))
  }

  // Throws when no signing key is configured: checkpoints are never skipped.
  const signing = initAuditSigning()
  console.log(`[mice-auth] audit checkpoints signed with key ${signing.keyId}`)

  // Refuses a non-empty unchained audit.jsonl (throws), writes genesis on an empty one, verifies the chain.
  const verification = initAudit()
  if (!verification.ok) console.error('[mice-auth] audit chain verification FAILED at boot', verification.firstBreak)
  startAuditVerifySchedule()
  startDatabaseBackupSchedule(openDatabase(), {
    dir: env.backupDir || join(dirname(databasePath()), 'backups'),
    keep: env.backupKeep,
    intervalMs: env.backupIntervalHours * 3_600_000,
  })
  startAuditCheckpointSchedule()
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.once(sig, () => {
      try {
        writeCheckpoint('shutdown')
      } catch (err) {
        console.error('[mice-auth] shutdown audit checkpoint failed', err)
      }
      closeDatabase()
      process.exit(0)
    })
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
