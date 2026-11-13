import { and, eq } from 'drizzle-orm'
import type { Hono } from 'hono'
import { getDb } from '../../db/database.js'
import { principals } from '../../db/schema.js'
import { isInstanceAdmin } from '../../authzInstanceStore.js'
import { guarded } from '../session/routeGuard.js'
import { canonicalIssuer } from '../session/principal.js'
import type { SessionUser } from '../session/session.js'
import { getAdminNameHistory } from '../session/nameChangeHistory.js'

const adminGate = async (user: SessionUser) => (await isInstanceAdmin(user) ? null : 'Admin required')

/** Stored name timeline for one Principal. Reads principal_name_history and does not ask the IdP. */
export function registerNameHistoryRoutes(app: Hono): void {
  app.get('/auth/admin/principals/names', guarded({ gate: adminGate }, async ({ c }) => {
    const iss = canonicalIssuer(c.req.query('iss') ?? '')
    const sub = (c.req.query('sub') ?? '').trim()
    if (!iss || !sub) return c.json({ error: 'Principal required' }, 400)
    const [principal] = await getDb()
      .select({ id: principals.id })
      .from(principals)
      .where(and(eq(principals.iss, iss), eq(principals.sub, sub)))
      .limit(1)
    if (!principal) return c.json({ error: 'Principal not found' }, 404)
    return c.json(await getAdminNameHistory(principal.id))
  }))
}
