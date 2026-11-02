import type { Hono } from 'hono'
import { desc, eq } from 'drizzle-orm'
import { guarded } from '../session/routeGuard.js'
import { principalKey, type PrincipalId } from '../session/principal.js'
import { isInstanceAdmin } from '../../authzInstanceStore.js'
import { getDb } from '../../db/database.js'
import { principals, webSessions } from '../../db/schema.js'
import {
  ACCESS_RESTORE_WINDOW_MS,
  confirmAccessRestore,
  getAccessState,
  liftAccessFlag,
  setAccessFlag,
} from './accessState.js'
import type { AuditDep } from '../../routeDeps.js'

const adminGate = async (u: { principalId?: number; sub: string; iss: string }) => {
  return (await isInstanceAdmin(u)) ? null : 'Instance admin required'
}

/** Admin input is `iss|sub`; verified email is accepted when a web Session has seen it. */
async function resolveTarget(raw: string): Promise<PrincipalId | null> {
  const value = decodeURIComponent(raw).trim()
  const bar = value.lastIndexOf('|')
  if (bar >= 0) return { iss: value.slice(0, bar), sub: value.slice(bar + 1) }
  if (!value.includes('@')) return null
  const [row] = await getDb()
    .select({ iss: principals.iss, sub: principals.sub })
    .from(webSessions)
    .innerJoin(principals, eq(principals.id, webSessions.principalId))
    .where(eq(webSessions.email, value))
    .orderBy(desc(webSessions.sessionStart))
    .limit(1)
  return row ?? null
}

const targetKey = (target: PrincipalId) => principalKey(target)

/** Admin view and actions for IdP disable state and Mice flags (ticket 04). */
export function registerAccessStateRoutes(app: Hono, { audit }: AuditDep): void {
  app.get('/auth/admin/access/:principal', guarded({
    gate: adminGate,
  }, async ({ c }) => {
    const target = await resolveTarget(c.req.param('principal'))
    if (!target) return c.json({ error: 'Use the Principal iss|sub' }, 400)
    const state = await getAccessState(target)
    return c.json({
      principal: targetKey(target),
      idpDisabledAt: state.idpDisabledAt?.toISOString() ?? null,
      restoreDeadline: state.restoreDeadline?.toISOString() ?? null,
      restoreRequiresApproval: state.restoreRequiresApproval,
      canAutoRestore: !!state.idpDisabledAt &&
        !state.restoreRequiresApproval &&
        state.flags.length === 0 &&
        Date.now() - state.idpDisabledAt.getTime() <= ACCESS_RESTORE_WINDOW_MS,
      flags: state.flags.map((f) => ({
        id: f.id,
        flag: f.flag,
        reason: f.reason,
        createdBy: f.createdBy,
        createdAt: f.createdAt.toISOString(),
      })),
    })
  }))

  app.post('/auth/admin/access/:principal/flags', guarded({
    gate: adminGate,
    mutates: true,
    body: { required: ['reason'] },
  }, async ({ c, user, body }) => {
    const target = await resolveTarget(c.req.param('principal'))
    if (!target) return c.json({ error: 'Use the Principal iss|sub' }, 400)
    const reason = String(body.reason)
    const flag = typeof body.flag === 'string' ? body.flag : 'mice'
    const id = await setAccessFlag(target, {
      flag,
      reason,
      createdBy: { iss: user.iss, sub: user.sub },
    })
    await audit(c, user, 'session', {
      action: 'admin.access_flag_set',
      message: `Set ${flag} flag for ${targetKey(target)}`,
      detail: { principal: targetKey(target), flag, reason, flagId: id },
    })
    return c.json({ ok: true, id })
  }))

  app.post('/auth/admin/access/:principal/flags/:id/lift', guarded({
    gate: adminGate,
    mutates: true,
    body: { required: ['reason'] },
  }, async ({ c, user, body }) => {
    const target = await resolveTarget(c.req.param('principal'))
    if (!target) return c.json({ error: 'Use the Principal iss|sub' }, 400)
    const id = Number(c.req.param('id'))
    if (!Number.isInteger(id)) return c.json({ error: 'Invalid flag id' }, 400)
    const reason = String(body.reason)
    const lifted = await liftAccessFlag(target, id, {
      liftedBy: { iss: user.iss, sub: user.sub },
      reason,
    })
    if (!lifted) return c.json({ error: 'Active flag not found' }, 404)
    await audit(c, user, 'session', {
      action: 'admin.access_flag_lifted',
      message: `Lifted flag ${id} for ${targetKey(target)}`,
      detail: { principal: targetKey(target), flagId: id, reason },
    })
    return c.json({ ok: true })
  }))

  app.post('/auth/admin/access/:principal/restore', guarded({
    gate: adminGate,
    mutates: true,
    body: { required: ['reason'] },
  }, async ({ c, user, body }) => {
    const target = await resolveTarget(c.req.param('principal'))
    if (!target) return c.json({ error: 'Use the Principal iss|sub' }, 400)
    const reason = String(body.reason)
    const restored = await confirmAccessRestore(target, {
      confirmedBy: { iss: user.iss, sub: user.sub },
      reason,
    })
    if (!restored) return c.json({ error: 'No suspended IdP access to restore' }, 404)
    await audit(c, user, 'session', {
      action: 'admin.access_restore_confirmed',
      message: `Re-confirmed access for ${targetKey(target)}`,
      detail: { principal: targetKey(target), reason },
    })
    return c.json({ ok: true })
  }))
}
