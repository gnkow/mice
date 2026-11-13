/**
 * Admin view of Principals who are disabled in the IdP and still hold signing rights (issue 11).
 */

import type { Hono } from 'hono'
import { isInstanceAdmin } from '../../authzInstanceStore.js'
import { guarded } from '../session/routeGuard.js'
import {
  checkDisabledPrincipalsWithSigningRights,
  type DisabledPrincipalAlarm,
} from './principalAccessMonitoring.js'

const requireInstanceAdmin = {
  gate: async (user: { sub: string; iss: string }) =>
    (await isInstanceAdmin(user)) ? null : 'Instance admin required',
  originCheck: true,
} as const

/** Optional check port; production uses the live principal-access monitor. */
export type DisabledSignerRouteDeps = {
  check?: () => Promise<DisabledPrincipalAlarm[]>
}

export function registerDisabledSignerRoutes(
  app: Hono,
  deps: DisabledSignerRouteDeps = {},
): void {
  const check = deps.check ?? checkDisabledPrincipalsWithSigningRights
  app.get('/auth/admin/disabled-signers', guarded(requireInstanceAdmin, async ({ c }) => {
    try {
      const alarms = await check()
      return c.json({ alarms })
    } catch (err) {
      return c.json({
        error: err instanceof Error ? err.message : 'Directory check failed',
      }, 503)
    }
  }))
}
