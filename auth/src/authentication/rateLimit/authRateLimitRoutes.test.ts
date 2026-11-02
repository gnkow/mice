import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { breakTable } from '../../db/testDatabase.js'

const { Hono } = await import('hono')
const { registerCliDeviceRoutes } = await import('../credentials/cliDeviceRoutes.js')
const { registerLoginRoutes } = await import('../oidc/loginRoutes.js')

const audit = async () => {}

function deviceApp() {
  const app = new Hono()
  registerCliDeviceRoutes(app, { audit })
  return app
}

function startDevice(app: ReturnType<typeof deviceApp>, ip: string) {
  return app.request('/auth/cli/device/start', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: '{}',
  })
}

await describe('authentication rate limits', async () => {
  await it('refuses the 6th device-flow start from one IP within a minute', async () => {
    const app = deviceApp()
    for (let i = 0; i < 5; i++) {
      const res = await startDevice(app, '203.0.113.24')
      assert.equal(res.status, 200, await res.text())
    }
    const blocked = await startDevice(app, '203.0.113.24')
    assert.equal(blocked.status, 429)
    assert.equal(blocked.headers.get('retry-after'), '60')
  })

  await it('refuses the 11th login callback from one IP within a minute', async () => {
    const app = new Hono()
    registerLoginRoutes(app, { audit })
    for (let i = 0; i < 10; i++) {
      const res = await app.request('/auth/callback', { headers: { 'x-forwarded-for': '203.0.113.25' } })
      assert.notEqual(res.status, 429)
    }
    const blocked = await app.request('/auth/callback', { headers: { 'x-forwarded-for': '203.0.113.25' } })
    assert.equal(blocked.status, 429)
    assert.equal(blocked.headers.get('retry-after'), '60')
  })

  await it('refuses the 21st token refresh from one IP within a minute', async () => {
    const app = deviceApp()
    for (let i = 0; i < 20; i++) {
      const res = await app.request('/auth/cli/refresh', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.26' },
        body: '{}',
      })
      assert.notEqual(res.status, 429)
    }
    const blocked = await app.request('/auth/cli/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.26' },
      body: '{}',
    })
    assert.equal(blocked.status, 429)
    assert.equal(blocked.headers.get('retry-after'), '60')
  })

  await it('shares one device-start counter across two BFF apps', async () => {
    const first = deviceApp()
    const second = deviceApp()
    for (let i = 0; i < 5; i++) {
      const res = await startDevice(first, '203.0.113.28')
      assert.equal(res.status, 200)
    }
    const blocked = await startDevice(second, '203.0.113.28')
    assert.equal(blocked.status, 429)
    assert.equal(blocked.headers.get('retry-after'), '60')
  })

  await it('returns 503 when the rate-limit store cannot be read', async () => {
    const app = deviceApp()
    const repair = await breakTable('rate_limits')
    const logged: unknown[][] = []
    const original = console.error
    console.error = (...args: unknown[]) => {
      logged.push(args)
    }
    try {
      const res = await startDevice(app, '203.0.113.29')
      assert.equal(res.status, 503)
      assert.equal(logged.some((args) => args.join(' ').includes('Rate limit storage failure')), true)
    } finally {
      console.error = original
      await repair()
    }
  })
})
