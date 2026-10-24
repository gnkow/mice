import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-wiring-'))
process.env.SESSION_SECRET = 'test-session-secret-for-wiring'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'root@x.io'

const { Hono } = await import('hono')
const { applyGlobalGuards, authenticateRequest } = await import('./requireAuth.js')
const { sealSession } = await import('./session.js')
const { createPat } = await import('./tokens.js')
const { offboard } = await import('./offboarding.js')
const { maybeBootstrapInstanceAdmin } = await import('./authzInstanceStore.js')
const { env } = await import('./env.js')

const adminRevoke = (actor: { iss: string; sub: string }, target: { iss: string; sub: string }) =>
  offboard(target, { scope: 'all', cause: 'admin-revocation', actor: { ...actor, email: '', name: '' } })
const mk = (sub: string) => ({ sub, iss: 'idp', email: `${sub}@x.io`, name: sub })
const root = mk('root')
maybeBootstrapInstanceAdmin({ ...root, emailVerified: true })

const app = new Hono()
applyGlobalGuards(app)
app.all('/whoami', async (c) => {
  const authed = await authenticateRequest(c, { allowScoped: true })
  return authed ? c.json({ sub: authed.user.sub, via: authed.via }) : c.json({}, 401)
})

const cookie = async (sub: string) =>
  `${env.cookieName}=${await sealSession({ ...mk(sub), sessionStart: Math.floor(Date.now() / 1000) - 30 })}`

describe('auth wiring (middleware order + requireAuth)', () => {
  it('prefers the session over a PAT when both are sent', async () => {
    const { token } = createPat(mk('bob'), 'b')
    const res = await app.request('/whoami', {
      headers: { cookie: await cookie('alice'), authorization: `Bearer ${token}` },
    })
    assert.deepEqual(await res.json(), { sub: 'alice', via: 'session' })
  })

  it('falls back to the PAT when the session is revoked', async () => {
    const { token } = createPat(mk('carol'), 'c')
    const stale = await cookie('dave')
    adminRevoke(root, mk('dave'))
    const res = await app.request('/whoami', {
      headers: { cookie: stale, authorization: `Bearer ${token}` },
    })
    assert.deepEqual(await res.json(), { sub: 'carol', via: 'pat' })
  })

  it('is 401 with a revoked session and no PAT', async () => {
    const stale = await cookie('erin')
    adminRevoke(root, mk('erin'))
    assert.equal((await app.request('/whoami', { headers: { cookie: stale } })).status, 401)
  })

  it('rejects a cross-site write on a cookie session before the route runs', async () => {
    const res = await app.request('/whoami', {
      method: 'POST',
      headers: { cookie: await cookie('alice'), 'sec-fetch-site': 'cross-site' },
    })
    assert.equal(res.status, 403)
  })

  it('lets a cross-site write through when authenticated by PAT', async () => {
    const { token } = createPat(mk('frank'), 'f')
    const res = await app.request('/whoami', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'sec-fetch-site': 'cross-site' },
    })
    assert.equal(res.status, 200)
  })
})
