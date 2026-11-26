import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { closeMainDatabase, openMainDatabase } from './db/database.js'
import {
  appendAudit,
  initAudit,
  listAllAuditEvents,
  setAuditObserver,
  startAuditVerifySchedule,
} from './packages/audit/index.js'
import {
  assertIdpAssurance,
  assertProductionStartup,
  ensureBootstrapKey,
  setAuthenticationObserver,
  startAccessReviewAlertSchedule,
  startClockDriftSchedule,
  startDirectorySyncSchedule,
  startIdpDriftSchedule,
  startSealKeyRotationSchedule,
} from './packages/authentication/index.js'
import { startInstancePermissionExpirySchedule } from './packages/authz/index.js'
import { resumeQueuedJobs } from './packages/jobs/index.js'
import {
  attachSessionsGuacGateway,
  resumeInterruptedProvisions,
  startSessionsLifecycleSweeper,
  startSessionLeaseRenewer,
} from './packages/desktop-sessions/index.js'
import { startWorkspaceBackground } from './packages/workspaces/routes.js'
import {
  captureNotificationAudit,
  rememberNotificationUser,
  startNotificationWorker,
} from './packages/notifications/index.js'
import {
  purgeFavoritesForAudit,
  recordBackupTargetCheck,
  recordRegulatedConfigAtStart,
  startCrossStoreIntegritySchedule,
  verifyAndRecordReleaseManifest,
} from './packages/platform/index.js'
import { acquireDataDirLock, env, oidcConfigured } from './packages/shared/index.js'
import { initAuditOutage } from './packages/audit/index.js'
import { listInstanceAdmins } from './packages/authz/index.js'
import { emitNotification } from './packages/notifications/index.js'
import { initWorkspaces } from './packages/workspaces/index.js'
import { getJob } from './packages/jobs/index.js'
import { getSessionRecord, listSessions } from './packages/desktop-sessions/index.js'
import { setGroupIssuerOverride } from './packages/authz/index.js'
import { directoryNow } from './packages/authentication/index.js'

/**
 * Starts the BFF: startup gate, data-directory lock, schedules, observers, the
 * app, background workers and the listener. In that order; `createApp` itself has no effects.
 */
export async function boot(): Promise<void> {
  assertProductionStartup()
  if (process.env.NODE_ENV === 'production') {
    await assertIdpAssurance(env.oidcIssuer)
    const dataLock = acquireDataDirLock(env.dataDir)
    process.on('exit', () => dataLock.release())
  }

  // PostgreSQL: applies the baseline on a blank database and refuses an unexpected schema version.
  await openMainDatabase()

  initAuditOutage({ notify: emitNotification, listAdmins: listInstanceAdmins })
  initWorkspaces({ getJob, getSessionRecord, listSessions })
  setGroupIssuerOverride(() => {
    try {
      const directory = directoryNow()
      return directory.configured && directory.issuer ? directory.issuer : null
    } catch {
      return null
    }
  })

  // Ticket 17: Initialize seal key ring with bootstrap key if none exists
  await ensureBootstrapKey()
  startSealKeyRotationSchedule()

  // Connects to immudb (creating the audit database on first use) and verifies the trail.
  const verification = await initAudit()
  if (!verification.ok) console.error('[mice-auth] audit verification FAILED at boot', verification.firstBreak)
  startAuditVerifySchedule({
    afterTick: async () => {
      // Orphan Intents are surfaced in the audit UI (no admin push notifications — SoD).
      const { readAuditAfterWithSeq } = await import('./packages/audit/index.js')
      const { replayAuditQueryIndex, verifyAuditQueryIndex } = await import('./packages/audit/index.js')
      await replayAuditQueryIndex(readAuditAfterWithSeq).catch((err) =>
        console.error('[mice-auth] audit query index replay failed', err),
      )
      await verifyAuditQueryIndex({
        ledgerEventIds: async () => (await listAllAuditEvents()).map((e) => e.id),
      }).catch((err) => console.error('[mice-auth] audit query index verify failed', err))
    },
  })
  if (process.env.NODE_ENV === 'production' && process.env.BACKUP_TARGET) {
    await recordBackupTargetCheck(process.env.BACKUP_TARGET)
  }
  {
    await verifyAndRecordReleaseManifest()
  }
  {
    await recordRegulatedConfigAtStart()
  }
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.once(sig, () => {
      void closeMainDatabase().finally(() => process.exit(0))
    })
  }

  startDirectorySyncSchedule()
  startIdpDriftSchedule() // Ticket 23: Daily IdP drift detection
  startAccessReviewAlertSchedule()
  startClockDriftSchedule()
  {
    startCrossStoreIntegritySchedule()
  }
  startInstancePermissionExpirySchedule({
    audit: async (event) => {
      await appendAudit({
        action: event.action,
        message: event.message,
        detail: event.detail,
        change: event.change,
        status: 200,
        method: 'SYSTEM',
        path: '/internal/instance-permission-expiry',
        via: 'system',
        actor: { sub: 'system', iss: 'mice', email: '', name: 'system' },
      })
    },
  })

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
