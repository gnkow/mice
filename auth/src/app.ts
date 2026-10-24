import { Hono, type Context } from 'hono'
import { backChannelLogout } from './backChannelLogout.js'
import { auditMutation } from './auditMutation.js'
import { registerAnnouncementRoutes } from './announcementRoutes.js'
import { registerAuditRoutes } from './auditRoutes.js'
import { registerCliDeviceRoutes } from './cliDeviceRoutes.js'
import { makeDirectorySyncRoute } from './directorySync.js'
import { registerFavoritesRoutes } from './favoritesRoutes.js'
import { registerInstanceRoutes } from './instanceRoutes.js'
import { registerJobRoutes } from './jobsRoutes.js'
import { registerLoginRoutes } from './loginRoutes.js'
import { registerMeRoutes } from './meRoutes.js'
import { registerMetaRoutes } from './metaRoutes.js'
import { registerNamespaceRoutes } from './namespaceRoutes.js'
import { registerNotificationRoutes } from './notifications.js'
import { proxyToOxen } from './proxy.js'
import { applyGlobalGuards, authenticateRequest } from './requireAuth.js'
import { registerRevocationRoutes } from './revocationRoutes.js'
import type { AuditFn } from './routeDeps.js'
import { signOutEverywhere } from './selfRevocation.js'
import type { SessionUser } from './session.js'
import { registerServicePrincipalRoutes } from './servicePrincipalRoutes.js'
import { registerSessionRoutes } from './sessionsRoutes.js'
import { registerStepUp } from './stepUp.js'
import { registerTokenRoutes } from './tokenRoutes.js'
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

  app.get('/healthz', (c) => c.json({ ok: true }))
  registerCliDeviceRoutes(app, { audit })
  registerMeRoutes(app, { audit })
  registerAuditRoutes(app, { audit })
  registerStepUp(app)
  registerLoginRoutes(app, { audit })

  app.post('/auth/backchannel-logout', backChannelLogout)
  app.post('/auth/instance/directory-sync', makeDirectorySyncRoute())
  registerServicePrincipalRoutes(app)
  app.post('/auth/sessions/revoke-all', signOutEverywhere)
  registerTokenRoutes(app, { audit })
  registerInstanceRoutes(app, { audit })
  registerRevocationRoutes(app)
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
