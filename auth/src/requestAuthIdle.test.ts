import './db/testSchema.js'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-idle-'))
process.env.SESSION_SECRET = 'test-session-secret-for-idle'
process.env.SESSION_IDLE_SEC = '600'
process.env.SESSION_TTL_SEC = '3600'

const { Hono } = await import('hono')
const { applyGlobalGuards } = await import('./requireAuth.js')
const { sealSession, getSession } = await import('./session.js')
const { env } = await import('./env.js')

const user = { sub: 'alice', iss: 'test', email: 'a@x.io', name: 'Alice' }
const now = () => Math.floor(Date.now() / 1000)

const app = new Hono()
applyGlobalGuards(app)
app.get('/me', async (c) => c.json({ ok: !!(await getSession(c)) }))
app.get('/auth/notifications/count', (c) => c.json({ ok: true }))

async function cookieFor(over: { sessionStart?: number; lastActive?: number }) {
  return `${env.cookieName}=${await sealSession({ ...user, ...over })}`
}

function cookieFrom(res: Response): string | null {
  const m = res.headers.get('set-cookie')?.match(new RegExp(`${env.cookieName}=([^;]+)`))
  return m ? `${env.cookieName}=${m[1]}` : null
}

describe('sliding idle timeout', () => {
  it('ends a Session idle longer than SESSION_IDLE_SEC', async () => {
    const cookie = await cookieFor({ lastActive: now() - 700 })
    const body = await (await app.request('/me', { headers: { cookie } })).json()
    assert.equal(body.ok, false)
  })

  it('extends the Session on activity', async () => {
    const cookie = await cookieFor({ lastActive: now() - 400 })
    const res = await app.request('/me', { headers: { cookie } })
    const fresh = cookieFrom(res)
    assert.ok(fresh, 'expected a re-sealed cookie')
    const user2 = await getSession({
      req: { raw: new Request('http://x', { headers: { cookie: fresh } }) },
    } as never)
    assert.ok(user2 && (user2.lastActive ?? 0) >= now() - 1)
  })

  it('does not move the absolute expiry when extending', async () => {
    const start = now() - 3000
    const cookie = await cookieFor({ sessionStart: start, lastActive: now() - 400 })
    const fresh = cookieFrom(await app.request('/me', { headers: { cookie } }))
    assert.ok(fresh)
    const { openSession } = await import('./session.js')
    const reopened = await openSession(fresh.split('=')[1])
    assert.equal(reopened?.sessionStart, start)
  })

  it('still ends a Session past the absolute TTL despite activity', async () => {
    const cookie = await cookieFor({ sessionStart: now() - 4000, lastActive: now() - 5 })
    const body = await (await app.request('/me', { headers: { cookie } })).json()
    assert.equal(body.ok, false)
  })

  it('does not extend on background polls', async () => {
    const cookie = await cookieFor({ lastActive: now() - 400 })
    const res = await app.request('/auth/notifications/count', { headers: { cookie } })
    assert.equal(cookieFrom(res), null)
  })
})
