import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { isolatedAuth } from './testSupport.js'

const ctx = isolatedAuth()
after(() => ctx.restore())

const { createApp } = await import('./app.js')

describe('createApp', () => {
  it('answers requests without a server', async () => {
    const app = createApp()
    const health = await app.request('/healthz')
    assert.deepEqual([health.status, await health.json()], [200, { ok: true }])
    const info = (await (await app.request('/auth/cli-info')).json()) as { loginExample: string }
    assert.equal(info.loginExample, 'mice login')
  })

  it('authenticates a Session cookie through the composed routes', async () => {
    const app = createApp()
    const anon = await app.request('/auth/me')
    assert.deepEqual([anon.status, await anon.json()], [401, { authenticated: false }])
    const me = await app.request('/auth/me', { headers: await ctx.sessionHeaders(ctx.person('ann')) })
    assert.equal(me.status, 200)
    assert.equal(((await me.json()) as { user: { sub: string } }).user.sub, 'ann')
  })

  it('keeps the proxy-compatible 401 shape on /api and forwards authenticated calls to the proxy', async () => {
    const calls: string[] = []
    const app = createApp({ proxy: async (c, { user }) => (calls.push(user.sub), c.json({ proxied: true })) })
    const anon = await app.request('/api/repos')
    assert.deepEqual(
      [anon.status, await anon.json()],
      [401, { status: 'error', status_message: 'unauthorized', error: { detail: 'Authentication required' } }],
    )
    const ok = await app.request('/api/repos', { headers: await ctx.sessionHeaders(ctx.person('ann')) })
    assert.deepEqual(await ok.json(), { proxied: true })
    assert.deepEqual(calls, ['ann'])
  })

  it('audits a native mutation through the injected audit function', async () => {
    const seen: string[] = []
    const app = createApp({ audit: (_c, user, _via, fields) => void seen.push(`${user.sub}:${fields.action}`) })
    await app.request('/auth/access-requests', {
      method: 'POST',
      headers: { ...(await ctx.sessionHeaders(ctx.person('bob'))), 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'please' }),
    })
    assert.deepEqual(seen, ['bob:access-request.submit'])
  })
})
