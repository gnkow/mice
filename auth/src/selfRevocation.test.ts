import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-selfrevoke-'))
process.env.SESSION_SECRET = 'test-session-secret-for-selfrevoke'

const { Hono } = await import('hono')
const { applyGlobalGuards, authenticateRequest } = await import('./requireAuth.js')
const { signOutEverywhere } = await import('./selfRevocation.js')
const { sealSession } = await import('./session.js')
const { createPat } = await import('./tokens.js')
const { queryAudit } = await import('./audit.js')
const { env } = await import('./env.js')

const mk = (sub: string) => ({ sub, iss: 'idp', email: `${sub}@x.io`, name: sub })
const app = new Hono()
applyGlobalGuards(app)
app.post('/auth/sessions/revoke-all', signOutEverywhere)
app.get('/whoami', async (c) => {
  const a = await authenticateRequest(c, { allowScoped: true })
  return a ? c.json({ via: a.via }) : c.json({}, 401)
})

const cookie = async (sub: string, ageSec = 30) =>
  `${env.cookieName}=${await sealSession({ ...mk(sub), sessionStart: Math.floor(Date.now() / 1000) - ageSec })}`
const post = (headers: Record<string, string>, body: unknown = {}) =>
  app.request('/auth/sessions/revoke-all', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost', ...headers },
    body: JSON.stringify(body),
  })

describe('sign out everywhere', () => {
  it('ends other Sessions but keeps PATs by default', async () => {
    const { token } = createPat(mk('al'), 'cli')
    const other = await cookie('al', 60)
    assert.equal((await post({ cookie: await cookie('al') })).status, 200)
    assert.equal((await app.request('/whoami', { headers: { cookie: other } })).status, 401)
    const viaPat = await app.request('/whoami', { headers: { authorization: `Bearer ${token}` } })
    assert.equal(viaPat.status, 200)
  })

  it('also revokes PATs when asked', async () => {
    await new Promise((r) => setTimeout(r, 1100))
    const { token } = createPat(mk('bo'), 'cli')
    assert.equal((await post({ cookie: await cookie('bo') }, { includePats: true })).status, 200)
    const viaPat = await app.request('/whoami', { headers: { authorization: `Bearer ${token}` } })
    assert.equal(viaPat.status, 401)
  })

  it('rejects PAT callers', async () => {
    const { token } = createPat(mk('cy'), 'cli')
    const res = await post({ authorization: `Bearer ${token}` })
    assert.equal(res.status, 401)
  })

  it('rejects cross-origin requests', async () => {
    const res = await post({ cookie: await cookie('di'), origin: 'https://evil.example' })
    assert.equal(res.status, 403)
  })

  it('audits the Principal with source self-service', async () => {
    await post({ cookie: await cookie('ed') })
    const ev = queryAudit({ actor: 'ed', action: 'session.revoke' }).events[0]
    assert.equal(ev?.actor.sub, 'ed')
    assert.equal(ev?.detail?.source, 'self-service')
  })
})
