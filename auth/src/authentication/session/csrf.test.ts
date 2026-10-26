import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-csrf-'))
process.env.SESSION_SECRET = 'test-session-secret-for-csrf'
process.env.PUBLIC_WEB_ORIGIN = 'https://mice.example.com'

const { Hono } = await import('hono')
const { sameOriginGuard } = await import('./csrf.js')
const { sealSession } = await import('./session.js')
const { env } = await import('../../env.js')
const { queryAudit } = await import('../../audit.js')

const token = await sealSession({
  sub: 'alice',
  iss: 'test',
  email: 'alice@example.com',
  name: 'Alice',
})
const cookie = `${env.cookieName}=${token}`

const app = new Hono()
app.use('*', sameOriginGuard)
app.all('/x', (c) => c.json({ ok: true }))

function hit(method: string, headers: Record<string, string>) {
  return app.request('http://mice.example.com/x', { method, headers })
}

describe('same-origin guard on cookie sessions', () => {
  it('rejects cross-site Sec-Fetch-Site writes', async () => {
    const res = await hit('POST', { cookie, 'sec-fetch-site': 'cross-site' })
    assert.equal(res.status, 403)
  })

  it('rejects same-site (sibling) writes', async () => {
    const res = await hit('DELETE', { cookie, 'sec-fetch-site': 'same-site' })
    assert.equal(res.status, 403)
  })

  it('rejects a foreign Origin when Sec-Fetch-Site is absent', async () => {
    const res = await hit('PUT', { cookie, origin: 'https://evil.example' })
    assert.equal(res.status, 403)
  })

  it('allows same-origin writes', async () => {
    const res = await hit('POST', { cookie, 'sec-fetch-site': 'same-origin' })
    assert.equal(res.status, 200)
  })

  it('allows the configured web origin and the request host', async () => {
    assert.equal((await hit('POST', { cookie, origin: 'https://mice.example.com' })).status, 200)
    assert.equal((await hit('POST', { cookie, origin: 'http://internal:8080', host: 'internal:8080' })).status, 200)
  })

  it('allows writes with no browser signals', async () => {
    assert.equal((await hit('POST', { cookie })).status, 200)
  })

  it('does not affect GET', async () => {
    const res = await hit('GET', { cookie, 'sec-fetch-site': 'cross-site' })
    assert.equal(res.status, 200)
  })

  it('does not affect bearer requests without a session cookie', async () => {
    const res = await hit('POST', {
      authorization: 'Bearer pat',
      'sec-fetch-site': 'cross-site',
    })
    assert.equal(res.status, 200)
  })

  it('audits the rejection', async () => {
    await hit('POST', { cookie, 'sec-fetch-site': 'cross-site' })
    const { events } = await queryAudit({ limit: 20 })
    assert.ok(events.some((e) => e.action === 'request.cross_site_rejected'))
  })
})
