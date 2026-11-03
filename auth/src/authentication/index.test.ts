import '../db/testSchema.js'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-authn-facade-'))
process.env.SESSION_SECRET = 'test-session-secret-for-facade'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'root@x.io'

const { Hono } = await import('hono')
const facade = await import('./index.js')
const { env } = await import('../env.js')
const { sealedSessionCookie } = await import('../testSupport.js')
const { authenticateRequest, requirePrincipal } = facade
type Principal = import('./index.js').Principal
type SessionUser = import('./index.js').SessionUser

const user = (sub: string): SessionUser => ({ sub, iss: 'idp', email: `${sub}@x.io`, name: sub })
const cookie = async (sub: string) => sealedSessionCookie(user(sub))

const app = new Hono()
app.get('/maybe', async (c) => {
  const r = await authenticateRequest(c, { credential: 'session' })
  return r ? c.json({ sub: r.user.sub, via: r.via }) : c.json({ error: 'denied' }, 401)
})
app.get('/must', async (c) => {
  try {
    const p: Principal = await requirePrincipal(c, { credential: 'session' })
    return c.json({ sub: p.sub })
  } catch {
    return c.json({ error: 'denied' }, 401)
  }
})

await describe('authentication facade', async () => {
  await it('authenticateRequest yields the Principal of a valid web session', async () => {
    const res = await app.request('/maybe', { headers: { cookie: await cookie('alice') } })
    assert.deepEqual(await res.json(), { sub: 'alice', via: 'session' })
  })

  await it('authenticateRequest yields null without a valid session', async () => {
    assert.equal((await app.request('/maybe')).status, 401)
    assert.equal((await app.request('/maybe', { headers: { cookie: `${env.cookieName}=garbage` } })).status, 401)
  })

  await it('requirePrincipal returns the Principal or rejects', async () => {
    const ok = await app.request('/must', { headers: { cookie: await cookie('bob') } })
    assert.deepEqual(await ok.json(), { sub: 'bob' })
    assert.equal((await app.request('/must')).status, 401)
  })

  await it('exports the route guard', () => {
    assert.equal(typeof facade.guarded, 'function')
    assert.equal(typeof facade.applyGlobalGuards, 'function')
  })
})
