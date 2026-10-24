import type { Hono } from 'hono'
import { authorizeManageOwnTokens, preparePrincipal } from './authz.js'
import { env } from './env.js'
import { authenticateUser } from './requireAuth.js'
import { parsePatScopes } from './patScopes.js'
import type { PatScope } from './session.js'
import { createPat, listPatsForUser, PatExpiryError, revokePat } from './tokens.js'
import type { AuditDep } from './routeDeps.js'

/** Personal access tokens: browser-session-only management of the caller's own PATs. */
export function registerTokenRoutes(app: Hono, { audit }: AuditDep): void {
  app.get('/auth/tokens', async (c) => {
    const session = await authenticateUser(c, { credential: 'session' })
    if (!session) return c.json({ error: 'Authentication required' }, 401)
    preparePrincipal(session)
    const gate = authorizeManageOwnTokens(session)
    if (!gate.allow) {
      return c.json({ error: gate.reason ?? 'Forbidden' }, 403)
    }
    return c.json({ tokens: listPatsForUser(session) })
  })

  app.post('/auth/tokens', async (c) => {
    const session = await authenticateUser(c, { credential: 'session' })
    if (!session) return c.json({ error: 'Authentication required' }, 401)
    preparePrincipal(session)
    const gate = authorizeManageOwnTokens(session)
    if (!gate.allow) {
      return c.json({ error: gate.reason ?? 'Forbidden' }, 403)
    }
    let label = 'CLI token'
    let scopes: PatScope[] | undefined
    let expiresInDays: number | undefined
    try {
      const body = (await c.req.json()) as {
        label?: string
        scopes?: PatScope[]
        expiresInDays?: number
      }
      if (body.expiresInDays !== undefined) expiresInDays = body.expiresInDays
      if (body.label?.trim()) label = body.label.trim()
      const parsed = parsePatScopes(body.scopes)
      if (!parsed.ok) return c.json({ error: parsed.error }, 400)
      scopes = parsed.scopes
    } catch {
      /* empty body ok */
    }
    let created: ReturnType<typeof createPat>
    try {
      created = createPat(session, label, { scopes, expiresInDays })
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
    audit(c, session, 'session', {
      action: 'token.create',
      message: `Created token: ${label}`,
      detail: { tokenId: pat.id, label, scopes, expiresAt: pat.expiresAt },
    })
    return c.json({
      token,
      pat,
      cli: {
        remote: env.publicOxenRemote,
        config: `oxen config --auth ${authHost} ${token}`,
      },
    })
  })

  app.delete('/auth/tokens/:id', async (c) => {
    const session = await authenticateUser(c, { credential: 'session' })
    if (!session) return c.json({ error: 'Authentication required' }, 401)
    preparePrincipal(session)
    const gate = authorizeManageOwnTokens(session)
    if (!gate.allow) {
      return c.json({ error: gate.reason ?? 'Forbidden' }, 403)
    }
    const id = c.req.param('id')
    const ok = revokePat(session, id)
    if (!ok) return c.json({ error: 'Token not found' }, 404)
    audit(c, session, 'session', {
      action: 'token.revoke',
      message: `Revoked token: ${id}`,
      detail: { tokenId: id },
    })
    return c.json({ ok: true })
  })
}
