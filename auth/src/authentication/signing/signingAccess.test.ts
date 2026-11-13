import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { Hono } from 'hono'
import { isolatedAuth } from '../../testSupport.js'
import { requireSigningAccess, SIGNING_STEP_UP_MAX_AGE_SEC } from './signingAccess.js'

/**
 * Signing access gate (Tickets 09 + 20): step-up then idle behind one interface.
 */

const iso = isolatedAuth({ OXEN_UPSTREAM: 'http://oxen.invalid' })
after(() => iso.restore())

const now = () => Math.floor(Date.now() / 1000)
const signer = { ...iso.person('access-signer'), name: 'Access Signer' }
await iso.grantRole(signer, 'user')

describe('requireSigningAccess', () => {
  it('exports the signing step-up window of 60 seconds', () => {
    assert.equal(SIGNING_STEP_UP_MAX_AGE_SEC, 60)
  })

  it('challenges when Session auth_time is outside the signing window', async () => {
    const app = new Hono()
    app.post('/probe', async (c) => {
      const { getSession } = await import('../session/session.js')
      const user = await getSession(c)
      assert.ok(user)
      const result = await requireSigningAccess(c, user, { freshnessSec: SIGNING_STEP_UP_MAX_AGE_SEC })
      if (!result.ok) return result.response
      return c.json({ ok: true })
    })

    const headers = {
      ...(await iso.sessionHeaders({
        ...signer,
        authTime: now() - 120,
        lastActive: now() - 10,
      } as typeof signer)),
      'content-type': 'application/json',
    }
    const res = await app.request('/probe', { method: 'POST', headers })
    assert.equal(res.status, 401)
    const body = (await res.json()) as { error: string; maxAge: number; reauthUrl: string }
    assert.equal(body.error, 'reauthentication_required')
    assert.equal(body.maxAge, 60)
    assert.match(body.reauthUrl, /\/auth\/reauth\?max_age=60/)
  })

  it('refuses with session_idle when lastActive exceeds the idle window', async () => {
    const app = new Hono()
    app.post('/probe', async (c) => {
      const { getSession } = await import('../session/session.js')
      const session = await getSession(c)
      assert.ok(session)
      // Step-up uses the cookie Session (fresh auth_time); idle uses the caller-supplied user.
      const result = await requireSigningAccess(
        c,
        { ...session, lastActive: now() - 16 * 60 },
        { freshnessSec: 60, sessionIdleSec: 900, nowSec: now() },
      )
      if (!result.ok) return result.response
      return c.json({ ok: true })
    })

    const headers = {
      ...(await iso.sessionHeaders({
        ...signer,
        authTime: now() - 5,
        lastActive: now() - 10,
      } as typeof signer)),
      'content-type': 'application/json',
    }
    const res = await app.request('/probe', { method: 'POST', headers })
    assert.equal(res.status, 401)
    const body = (await res.json()) as { error: string; message: string }
    assert.equal(body.error, 'session_idle')
    assert.match(body.message, /re-authenticate/)
  })

  it('allows when step-up is fresh and lastActive is inside the idle window', async () => {
    const app = new Hono()
    app.post('/probe', async (c) => {
      const { getSession } = await import('../session/session.js')
      const user = await getSession(c)
      assert.ok(user)
      const result = await requireSigningAccess(c, user, {
        freshnessSec: 60,
        sessionIdleSec: 900,
        nowSec: now(),
      })
      if (!result.ok) return result.response
      return c.json({ ok: true, sub: result.user.sub })
    })

    const headers = {
      ...(await iso.sessionHeaders({
        ...signer,
        authTime: now() - 5,
        lastActive: now() - 30,
      } as typeof signer)),
      'content-type': 'application/json',
    }
    const res = await app.request('/probe', { method: 'POST', headers })
    assert.equal(res.status, 200)
    assert.equal(((await res.json()) as { sub: string }).sub, signer.sub)
  })
})
