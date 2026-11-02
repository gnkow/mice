import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { fakeClock, useClock } from '../../clock.js'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-selfrevoke-'))
process.env.SESSION_SECRET = 'test-session-secret-for-selfrevoke'

const { Hono } = await import('hono')
const { applyGlobalGuards, authenticateRequest } = await import('../session/requireAuth.js')
const { signOutEverywhere } = await import('./selfRevocation.js')
const { sealSession } = await import('../session/session.js')
const { sealSessionCookie } = await import('../session/cookieSeal.js')
const { ensureBootstrapKey } = await import('../session/sealKeys.js')
const { issueCliCredential } = await import('./cliCredentials.js')
const { queryAudit } = await import('../../audit.js')
const { env } = await import('../../env.js')

const mk = (sub: string) => ({ sub, iss: 'idp', email: `${sub}@x.io`, name: sub })
const app = new Hono()
applyGlobalGuards(app)
app.post('/auth/sessions/revoke-all', signOutEverywhere)
app.get('/whoami', async (c) => {
  const a = await authenticateRequest(c, { allowScoped: true })
  return a ? c.json({ via: a.via }) : c.json({}, 401)
})

await ensureBootstrapKey()
const cookie = async (sub: string, ageSec = 30) => {
  const sessionId = await sealSession({ ...mk(sub), sessionStart: Math.floor(Date.now() / 1000) - ageSec })
  return `${env.cookieName}=${await sealSessionCookie(sessionId)}`
}
const post = (headers: Record<string, string>, body: unknown = {}) =>
  app.request('/auth/sessions/revoke-all', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost', host: 'localhost', ...headers },
    body: JSON.stringify(body),
  })

const clock = fakeClock(Date.now())
const restoreClock = useClock(clock)
after(restoreClock)

await describe('sign out everywhere', async () => {
  await it('ends other Sessions and CLI credentials', async () => {
    const { accessToken } = await issueCliCredential(mk('al'))
    const other = await cookie('al', 60)
    assert.equal((await post({ cookie: await cookie('al') })).status, 200)
    assert.equal((await app.request('/whoami', { headers: { cookie: other } })).status, 401)
    const viaCli = await app.request('/whoami', { headers: { authorization: `Bearer ${accessToken}` } })
    assert.equal(viaCli.status, 401)
  })

  await it('rejects CLI credential callers', async () => {
    const { accessToken } = await issueCliCredential(mk('cy'))
    const res = await post({ authorization: `Bearer ${accessToken}` })
    assert.equal(res.status, 401)
  })

  await it('rejects cross-origin requests', async () => {
    const res = await post({ cookie: await cookie('di'), origin: 'https://evil.example' })
    assert.equal(res.status, 403)
  })

  await it('audits the Principal with source self-service', async () => {
    await post({ cookie: await cookie('ed') })
    const ev = (await queryAudit({ actor: 'ed', action: 'session.revoke' })).events[0]
    assert.equal(ev?.actor.sub, 'ed')
    assert.equal(ev?.detail?.source, 'self-service')
  })
})
