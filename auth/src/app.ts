import { Hono, type Context } from 'hono'
import { applyGlobalGuards, authenticateOutcome } from './packages/authentication/session.js'
import { backChannelLogout, makeDirectorySyncRoute, registerAccessReviewRoutes, registerNameHistoryRoutes, registerAdminRevocationRoutes, registerMiceSuspensionRoutes, registerReenableRoutes, registerAuthEventRoutes, registerCliDeviceRoutes, registerIdpBaselineRoutes, registerIdpDriftRoutes, registerDisabledSignerRoutes, registerLoginRoutes, registerMeRoutes, registerRevocationRoutes, registerSealKeyRoutes, registerSigningRoutes, registerStepUp, registerWebSessionRoutes, registerDevSessionRoutes } from './packages/authentication/routes.js'
import { changeCaptureResponse } from './packages/authentication/session.js'
import type { SessionUser } from './packages/authentication/principal.js'
import { signOutEverywhere } from './packages/authentication/index.js'
import { auditReadiness, auditMutation } from './packages/audit/index.js'
import {
  registerAuditRoutes,
  registerAuditVisibilityRoutes,
  registerAuditHealthRoutes,
} from './packages/audit/routes.js'
import { registerRbacGrantRoutes } from './packages/authz/routes.js'
import { proxyToOxen } from './packages/proxy/index.js'
import { registerJobRoutes } from './packages/jobs/routes.js'
import { registerSessionRoutes } from './packages/desktop-sessions/routes.js'
import { registerWorkspaceRoutes } from './packages/workspaces/routes.js'
import { registerMergeRequestRoutes } from './packages/merge/routes.js'
import { registerNamespaceRoutes } from './packages/namespaces/routes.js'
import { notificationReadiness, registerNotificationRoutes } from './packages/notifications/index.js'
import {
  registerAnnouncementRoutes,
  registerFavoritesRoutes,
  registerInstanceRoutes,
  registerOpsRoutes,
  registerReasonRoutes,
  registerRegulatedConfigRoutes,
  registerReleaseManifestRoutes,
  registerMetaRoutes,
} from './packages/platform/routes.js'
import { diskReadiness, type AuditFn } from './packages/shared/index.js'
import { postgresReadiness } from './db/database.js'
import { isStoreOutage } from './db/outage.js'

export type AppDeps = {
  /** Audit sink for BFF-native mutations; defaults to the audit log. */
  audit?: AuditFn
  /** Forwards an authenticated `/api/*` request to oxen; defaults to the real proxy. */
  proxy?: (c: Context, auth: { user: SessionUser; via: 'session' | 'pat' }) => Promise<Response>
}

/**
 * Builds the HTTP app. It registers routes and guards only: no timers, no listener, no
 * migrations, no workers. `boot.ts` owns those.
 */
export function createApp(deps: AppDeps = {}): Hono {
  const audit = deps.audit ?? auditMutation
  const proxy = deps.proxy ?? proxyToOxen
  const app = new Hono()
  applyGlobalGuards(app)
  app.onError((err, c) => {
    // Handlers outside `guarded` still refuse no-op mutations and fail closed on change capture.
    const changeRefusal = changeCaptureResponse(err, c)
    if (changeRefusal) return changeRefusal
    if (isStoreOutage(err)) {
      console.error('[mice-auth] store unavailable', err instanceof Error ? err.message : 'unknown error')
      return c.json({ status: 'error', status_message: 'store_unavailable', error: { detail: 'A required store is unavailable' } }, 503)
    }
    console.error('[mice-auth] unhandled error', err)
    return c.json({ status: 'error', status_message: 'internal_error' }, 500)
  })

  app.get('/healthz', (c) => c.json({ ok: true }))
  // Readiness covers PostgreSQL, the workspace disk, the audit store and chain state, and Novu; liveness above stays static.
  app.get('/readyz', async (c) => {
    const audit = await auditReadiness()
    const storage = diskReadiness()
    const postgres = await postgresReadiness()
    const notifications = await notificationReadiness()
    const ok = audit.ok && storage.ok && postgres.ok && notifications.ok
    return c.json({ ok, audit, storage, postgres, notifications }, ok ? 200 : 503)
  })
  registerCliDeviceRoutes(app, { audit })
  registerAuthEventRoutes(app)
  registerAdminRevocationRoutes(app, { audit })
  registerMiceSuspensionRoutes(app, { audit })
  registerReenableRoutes(app, { audit })
  registerSigningRoutes(app, { audit })
  registerIdpBaselineRoutes(app, { audit })
  registerIdpDriftRoutes(app)
  registerDisabledSignerRoutes(app)
  registerAccessReviewRoutes(app, { audit })
  registerNameHistoryRoutes(app)
  registerMeRoutes(app, { audit })
  registerAuditRoutes(app, { audit })
  registerAuditVisibilityRoutes(app, { audit })
  registerAuditHealthRoutes(app, { audit })
  registerReleaseManifestRoutes(app, { audit })
  registerRegulatedConfigRoutes(app, { audit })
  registerStepUp(app)
  registerLoginRoutes(app, { audit })
  registerWebSessionRoutes(app, { audit })
  registerSealKeyRoutes(app)
  registerDevSessionRoutes(app)

  app.post('/auth/backchannel-logout', backChannelLogout)
  app.post('/auth/instance/directory-sync', makeDirectorySyncRoute())
  app.post('/auth/sessions/revoke-all', signOutEverywhere)
  registerInstanceRoutes(app, { audit })
  registerOpsRoutes(app, { audit })
  registerRbacGrantRoutes(app, { audit })
  registerRevocationRoutes(app)
  registerReasonRoutes(app)
  registerNamespaceRoutes(app, { audit })
  registerMergeRequestRoutes(app, { audit })

  app.all('/api/*', async (c) => {
    const authed = await authenticateOutcome(c, { allowScoped: true })
    if (!authed.ok) {
      return c.json(
        {
          status: 'error',
          status_message: authed.status === 401 ? 'unauthorized' : 'forbidden',
          error: { detail: authed.error },
        },
        authed.status,
      )
    }
    return proxy(c, { user: authed.user, via: authed.via })
  })

  registerJobRoutes(app)
  registerWorkspaceRoutes(app)
  registerMetaRoutes(app)
  registerFavoritesRoutes(app)
  registerAnnouncementRoutes(app, { audit })
  registerSessionRoutes(app)
  registerNotificationRoutes(app)
  return app
}
