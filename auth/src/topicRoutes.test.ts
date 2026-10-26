import './db/testSchema.js'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-topic-'))
process.env.SESSION_SECRET = 'test-session-secret-for-topic'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'root@x.io'

const { Hono } = await import('hono')
const { registerTokenRoutes } = await import('./authentication/credentials/tokenRoutes.js')
const { registerInstanceRoutes } = await import('./instanceRoutes.js')
const { registerRevocationRoutes } = await import('./authentication/credentials/revocationRoutes.js')
const { sealSession } = await import('./authentication/session/session.js')
const { createPat, resolvePat } = await import('./authentication/credentials/tokens.js')
const { maybeBootstrapInstanceAdmin } = await import('./authzInstanceStore.js')
const { env } = await import('./env.js')

const mk = (sub: string) => ({ sub, iss: 'idp', email: `${sub}@x.io`, name: sub })
await maybeBootstrapInstanceAdmin({ ...mk('root'), emailVerified: true })

const audited: string[] = []
const app = new Hono()
const audit = async (_c: unknown, _u: unknown, _v: unknown, f: { action: string }) => void audited.push(f.action)
registerTokenRoutes(app, { audit })
registerInstanceRoutes(app, { audit })
registerRevocationRoutes(app)

const cookie = async (sub: string) =>
  ({ cookie: `${env.cookieName}=${await sealSession({ ...mk(sub), sessionStart: Math.floor(Date.now() / 1000) - 30 })}` })
const json = { 'content-type': 'application/json', 'x-mice-reason': 'Routine test change' }

await describe('token routes', async () => {
  await it('requires a browser Session', async () => {
    assert.equal((await app.request('/auth/tokens')).status, 401)
    const { token } = await createPat(mk('pat-user'), 'x')
    assert.equal((await app.request('/auth/tokens', { headers: { authorization: `Bearer ${token}` } })).status, 401)
  })

  await it('denies a non-admin without manage_own_tokens when enforcement is on', async () => {
    assert.equal((await app.request('/auth/tokens', { headers: await cookie('plain') })).status, 403)
  })

  await it('mints, lists and revokes the caller\'s own token, auditing each', async () => {
    const h = await cookie('root')
    const made = await app.request('/auth/tokens', { method: 'POST', headers: { ...h, ...json }, body: JSON.stringify({ label: 'ci' }) })
    assert.equal(made.status, 200)
    const { token, pat } = (await made.json()) as { token: string; pat: { id: string } }
    assert.ok(await resolvePat(token))
    const list = (await (await app.request('/auth/tokens', { headers: h })).json()) as { tokens: unknown[] }
    assert.equal(list.tokens.length, 1)
    assert.equal((await app.request(`/auth/tokens/${pat.id}`, { method: 'DELETE', headers: h })).status, 200)
    assert.equal(await resolvePat(token), null)
    assert.deepEqual(audited.filter((a) => a.startsWith('token.')), ['token.create', 'token.revoke'])
  })
})

await describe('instance routes', async () => {
  await it('refuses non-admins and lets an admin read and toggle enforcement', async () => {
    assert.equal((await app.request('/auth/instance', { headers: await cookie('nobody') })).status, 403)
    const h = await cookie('root')
    assert.equal((await app.request('/auth/instance', { headers: h })).status, 200)
    const r = await app.request('/auth/instance', { method: 'PATCH', headers: { ...h, ...json }, body: JSON.stringify({ enforce: false }) })
    assert.deepEqual(await r.json(), { enforce: false })
    assert.ok(audited.includes('instance.settings.update'))
  })

  await it('validates and audits the admin list changes', async () => {
    const h = { ...(await cookie('root')), ...json }
    const bad = await app.request('/auth/instance/admins', { method: 'POST', headers: h, body: '{}' })
    assert.equal(bad.status, 400)
    const denied = await app.request('/auth/instance/admins', { method: 'POST', headers: { ...(await cookie('nobody')), ...json }, body: JSON.stringify({ sub: 'x', iss: 'idp' }) })
    assert.equal(denied.status, 403)
    assert.ok(audited.includes('instance.admin.add'))
  })
})

await describe('revocation routes', async () => {
  await it('lets an admin cut off a Principal and refuses others', async () => {
    const { token } = await createPat(mk('victim'), 'v')
    const body = JSON.stringify({ sub: 'victim', iss: 'idp' })
    const denied = await app.request('/auth/instance/revoke-sessions', { method: 'POST', headers: { ...(await cookie('nobody')), ...json }, body })
    assert.equal(denied.status, 403)
    assert.ok(await resolvePat(token))
    const ok = await app.request('/auth/instance/revoke-sessions', { method: 'POST', headers: { ...(await cookie('root')), ...json }, body })
    assert.equal(ok.status, 200)
    assert.equal(await resolvePat(token), null)
  })
})
