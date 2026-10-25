import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-sprt-'))
process.env.SESSION_SECRET = 'test-secret-sprt'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'root@x.io'

const { Hono } = await import('hono')
const { registerServicePrincipalRoutes } = await import('./servicePrincipalRoutes.js')
const { getSession, sealSession } = await import('./session.js')
const { resolvePat } = await import('./tokens.js')
const { maybeBootstrapInstanceAdmin } = await import('./authzInstanceStore.js')
const { env } = await import('./env.js')

const mk = (sub: string) => ({ sub, iss: 'idp', email: `${sub}@x.io`, name: sub })
maybeBootstrapInstanceAdmin({ ...mk('root'), emailVerified: true })

const app = new Hono()
registerServicePrincipalRoutes(app)
const cookie = async (sub: string) => `${env.cookieName}=${await sealSession({ ...mk(sub), sessionStart: Math.floor(Date.now() / 1000) })}`
const call = async (as: string | null, method: string, path: string, body?: unknown) =>
  app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-mice-reason': 'Routine test change', ...(as ? { cookie: await cookie(as) } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })

describe('service principal routes', () => {
  it('admins create and list; non-admins and anonymous cannot', async () => {
    assert.equal((await call(null, 'GET', '/auth/instance/service-principals')).status, 401)
    assert.equal((await call('alice', 'POST', '/auth/instance/service-principals', { name: 'ci', owner: mk('alice') })).status, 403)
    assert.equal((await call('root', 'POST', '/auth/instance/service-principals', { name: 'ci' })).status, 400)
    const created = await call('root', 'POST', '/auth/instance/service-principals', { name: 'ci', owner: mk('alice') })
    assert.equal(created.status, 201)
    const list = (await (await call('root', 'GET', '/auth/instance/service-principals')).json()) as { servicePrincipals: unknown[] }
    assert.equal(list.servicePrincipals.length, 1)
  })

  it('lets the owner mint a PAT (expiry rules apply) and admin reassign; others are refused', async () => {
    const { servicePrincipal } = (await (await call('root', 'POST', '/auth/instance/service-principals', { name: 'ci2', owner: mk('bob') })).json()) as { servicePrincipal: { id: string } }
    const tokens = `/auth/instance/service-principals/${servicePrincipal.id}/tokens`
    assert.equal((await call('mallory', 'POST', tokens, {})).status, 403)
    assert.equal((await call('bob', 'POST', tokens, { expiresInDays: 366 })).status, 400)
    const ok = await call('bob', 'POST', tokens, { label: 'ci' })
    assert.equal(ok.status, 201)
    const { token } = (await ok.json()) as { token: string }
    assert.equal(resolvePat(token)?.sub, servicePrincipal.id)
    const re = `/auth/instance/service-principals/${servicePrincipal.id}/reassign`
    assert.equal((await call('bob', 'POST', re, { owner: mk('carl') })).status, 403)
    assert.equal((await call('root', 'POST', re, { owner: mk('carl') })).status, 200)
    assert.equal((await call('bob', 'POST', tokens, {})).status, 403)
    assert.equal((await call('carl', 'POST', tokens, {})).status, 201)
  })
})
