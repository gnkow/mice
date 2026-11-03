import { Hono, type Context } from 'hono'
import { auditReadiness } from './audit.js'
import { diskReadiness } from './diskStore.js'
import { postgresReadiness } from './db/database.js'
import { isStoreOutage } from './db/outage.js'
import { applyGlobalGuards, authenticateRequest, backChannelLogout, makeDirectorySyncRoute, registerAccessReviewRoutes, registerNameHistoryRoutes, registerAdminRevocationRoutes, registerMiceSuspensionRoutes, registerReenableRoutes, registerAuthEventRoutes, registerCliDeviceRoutes, registerIdpBaselineRoutes, registerIdpDriftRoutes, registerDisabledSignerRoutes, registerLoginRoutes, registerMeRoutes, registerRevocationRoutes, registerSealKeyRoutes, registerSigningRoutes, registerStepUp, registerWebSessionRoutes, type SessionUser, signOutEverywhere } from './authentication/index.js'
import { auditMutation } from './auditMutation.js'
import { registerAnnouncementRoutes } from './announcementRoutes.js'
import { registerAuditRoutes } from './auditRoutes.js'
import { registerFavoritesRoutes } from './favoritesRoutes.js'
import { registerInstanceRoutes } from './instanceRoutes.js'
import { registerJobRoutes } from './jobsRoutes.js'
import { registerMetaRoutes } from './metaRoutes.js'
import { registerNamespaceRoutes } from './namespaceRoutes.js'
import { notificationReadiness, registerNotificationRoutes } from './notifications.js'
import { proxyToOxen } from './proxy.js'
import { registerReasonRoutes } from './reasonRoutes.js'
import type { AuditFn } from './routeDeps.js'
import { registerSessionRoutes } from './sessionsRoutes.js'
import { registerWorkspaceRoutes } from './workspaces/routes.js'

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
  registerStepUp(app)
  registerLoginRoutes(app, { audit })
  registerWebSessionRoutes(app)
  registerSealKeyRoutes(app)

  app.post('/auth/backchannel-logout', backChannelLogout)
  app.post('/auth/instance/directory-sync', makeDirectorySyncRoute())
  // Service principals removed per spec: "There are no PATs and no service principals"
  app.post('/auth/sessions/revoke-all', signOutEverywhere)
  // PAT routes removed per spec: "There are no PATs and no service principals"
  // Use device flow (mice login) for CLI access instead
  // registerTokenRoutes removed with personal access tokens.
  registerInstanceRoutes(app, { audit })
  registerRevocationRoutes(app)
  registerReasonRoutes(app)
  registerNamespaceRoutes(app, { audit })

  app.all('/api/*', async (c) => {
    const authed = await authenticateRequest(c, { allowScoped: true })
    if (!authed) {
      return c.json(
        {
          status: 'error',
          status_message: 'unauthorized',
          error: { detail: 'Authentication required' },
        },
        401,
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
