import './db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { isolatedAuth } from './testSupport.js'

const ctx = isolatedAuth({ AUTHZ_BOOTSTRAP_ADMINS: 'root@mice.local' })
after(() => ctx.restore())

describe('testSupport', () => {
  it('builds principals with stable shape', () => {
    assert.deepEqual(ctx.person('ann'), { sub: 'ann', iss: 'test', email: 'ann@example.com', name: 'ann' })
    assert.equal(ctx.admin.email, 'root@mice.local')
    assert.equal(ctx.admin.emailVerified, true)
  })

  it('seals a session cookie that authenticates through the real interface', async () => {
    const { Hono } = await import('hono')
    const { authenticateUser } = await import('./authentication/index.js')
    const app = new Hono()
    app.get('/me', async (c) => {
      const u = await authenticateUser(c, { credential: 'session' })
      return c.json({ sub: u?.sub ?? null })
    })
    const res = await app.request('http://localhost/me', { headers: await ctx.sessionHeaders(ctx.person('ann')) })
    assert.deepEqual(await res.json(), { sub: 'ann' })
  })


  it('restores the previous environment', () => {
    ctx.restore()
    assert.equal(process.env.AUTHZ_BOOTSTRAP_ADMINS === 'root@mice.local', false)
  })
})
