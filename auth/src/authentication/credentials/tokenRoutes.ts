import type { Hono } from 'hono'
import { authorizeManageOwnTokens } from '../../authz.js'
import { env } from '../../env.js'
import { guarded } from '../session/routeGuard.js'
import { parsePatScopes } from './patScopes.js'
import type { PatScope } from '../session/session.js'
import { createPat, listPatsForUser, PatExpiryError, revokePat } from './tokens.js'
import type { AuditDep } from '../../routeDeps.js'

const ownTokens = async (u: Parameters<typeof authorizeManageOwnTokens>[0]) => {
  const gate = await authorizeManageOwnTokens(u)
  return gate.allow ? null : (gate.reason ?? 'Forbidden')
}
const sessionOnly = { credential: 'session', gate: ownTokens } as const

/** Personal access tokens: browser-session-only management of the caller's own PATs. */
export function registerTokenRoutes(app: Hono, { audit }: AuditDep): void {
  app.get('/auth/tokens', guarded(sessionOnly, async ({ c, user }) => c.json({ tokens: await listPatsForUser(user) })))

  app.post(
    '/auth/tokens',
    guarded({ ...sessionOnly, mutates: true, body: 'optional' }, async ({ c, user, body }) => {
      const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim() : 'CLI token'
      const expiresInDays = body.expiresInDays as number | undefined
      const parsed = parsePatScopes(body.scopes as PatScope[] | undefined)
      if (!parsed.ok) return c.json({ error: parsed.error }, 400)
      const scopes = parsed.scopes
      let created: Awaited<ReturnType<typeof createPat>>
      try {
        created = await createPat(user, label, { scopes, expiresInDays })
      } catch (e) {
        if (e instanceof PatExpiryError) return c.json({ error: e.message }, 400)
        throw e
      }
      const { token, pat } = created
      let authHost = env.publicOxenRemote
      try {
        authHost = new URL(env.publicOxenRemote).host
      } catch {
        /* keep */
      }
      await audit(c, user, 'session', {
        action: 'token.create',
        message: `Created token: ${label}`,
        detail: { tokenId: pat.id, label, scopes, expiresAt: pat.expiresAt },
      })
      return c.json({
        token,
        pat,
        cli: { remote: env.publicOxenRemote, config: `oxen config --auth ${authHost} ${token}` },
      })
    }),
  )

  app.delete(
    '/auth/tokens/:id',
    guarded({ ...sessionOnly, mutates: true }, async ({ c, user }) => {
      const id = c.req.param('id') ?? ''
      if (!await revokePat(user, id)) return c.json({ error: 'Token not found' }, 404)
      await audit(c, user, 'session', {
        action: 'token.revoke',
        message: `Revoked token: ${id}`,
        detail: { tokenId: id },
      })
      return c.json({ ok: true })
    }),
  )
}
