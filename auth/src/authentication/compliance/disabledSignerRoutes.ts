/**
 * Admin view of Principals who are disabled in the IdP and still hold signing rights (issue 11).
 */

import type { Hono } from 'hono'
import { isInstanceAdmin } from '../../authzInstanceStore.js'
import { guarded } from '../session/routeGuard.js'
import { checkDisabledPrincipalsWithSigningRights } from './principalAccessMonitoring.js'

const requireInstanceAdmin = {
  gate: async (user: { sub: string; iss: string }) =>
    (await isInstanceAdmin(user)) ? null : 'Instance admin required',
  originCheck: true,
} as const

export function registerDisabledSignerRoutes(app: Hono): void {
  app.get('/auth/admin/disabled-signers', guarded(requireInstanceAdmin, async ({ c }) => {
    try {
      const alarms = await checkDisabledPrincipalsWithSigningRights()
      return c.json({ alarms })
    } catch (err) {
      return c.json({
        error: err instanceof Error ? err.message : 'Directory check failed',
      }, 503)
    }
  }))
}
