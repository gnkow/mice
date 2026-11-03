import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'

// Every database is unreachable: the service must refuse, never half-succeed.
process.env.POSTGRES_PORT = '1'
process.env.POSTGRES_PASSWORD = 'unused'
process.env.IMMUDB_PORT = '1'
process.env.IMMUDB_PASSWORD = 'unused'
process.env.NOVU_URL = 'http://127.0.0.1:1'
process.env.NOVU_PASSWORD = 'Unused1!'
process.env.SESSION_SECRET = 'outage-test-secret'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'admin@outage.test'
process.env.OXEN_UPSTREAM = 'http://oxen.invalid'
process.env.PUBLIC_WEB_ORIGIN = 'http://localhost'

const { createApp } = await import('./app.js')
const { env } = await import('./env.js')
const { closeMainDatabase } = await import('./db/database.js')
const { setUpstreamFetch } = await import('./proxy.js')

after(() => closeMainDatabase())

const app = createApp()
// Four cookie segments force an unseal, which has to read the seal-key table.
const headers = () => ({
  cookie: `${env.cookieName}=aaaa.bbbb.cccc.dddd`,
  origin: 'http://localhost',
})

await describe('database outage fails closed', async () => {
  await it('/readyz is red and names every unreachable store; /healthz stays up', async () => {
    const res = await app.request('/readyz')
    assert.equal(res.status, 503)
    const body = await res.json()
    assert.equal(body.postgres.ok, false)
    assert.equal(body.audit.ok, false)
    assert.equal(body.notifications.ok, false)
    assert.equal((await app.request('/healthz')).status, 200)
  })

  await it('the notification inbox answers 503', async () => {
    assert.equal((await app.request('/auth/notifications', { headers: await headers() })).status, 503)
  })

  await it('a mutation is refused before it reaches the upstream', async () => {
    let upstream = 0
    const restore = setUpstreamFetch(async () => { upstream++; return new Response('{}', { status: 200 }) })
    try {
      const res = await app.request('/api/repos/ns/r/file/main/a.csv', {
        method: 'PUT',
        headers: { ...(await headers()), 'content-type': 'application/json', 'x-mice-reason': 'Routine test change' },
        body: '{}',
      })
      assert.equal(res.status, 503)
      assert.equal(upstream, 0)
    } finally { restore() }
  })
})
