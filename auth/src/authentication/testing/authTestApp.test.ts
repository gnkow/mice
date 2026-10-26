import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { createAuthTestApp } from './authTestApp.js'

/**
 * Table-driven suite format: each row names a scenario and an `run` that drives the app over HTTP through
 * `t.login`. Add a row, not a new test body. See `testing/README.md`.
 */
const t = await createAuthTestApp({
  idp: {
    users: {
      ann: { email: 'ann@mice.local', name: 'Ann Example' },
      nameless: { email: 'nameless@mice.local', name: null },
      gone: { email: 'gone@mice.local', disabled: true },
    },
  },
})
after(() => t.close())

type Harness = typeof t
type Row = { name: string; run: (t: Harness) => Promise<void> }

const rows: Row[] = [
  {
    name: 'a configured IdP user signs in and /auth/me returns that identity',
    async run(t) {
      const login = await t.login('ann')
      assert.equal(login.status, 302)
      const me = await t.app.request('/auth/me', { headers: login.headers })
      assert.equal(me.status, 200)
      const body = (await me.json()) as { user: { sub: string; email: string; name: string } }
      assert.deepEqual(
        [body.user.sub, body.user.email, body.user.name],
        ['ann', 'ann@mice.local', 'Ann Example'],
      )
    },
  },
  {
    name: 'the callback redirects to the safe return path and drops an unsafe one',
    async run(t) {
      const safe = await t.login('ann', { next: '/cli/device?user_code=ABCD' })
      assert.equal(safe.location, '/cli/device?user_code=ABCD')
      const unsafe = await t.login('ann', { next: '//evil.example' })
      assert.equal(unsafe.location, '/')
    },
  },
  {
    name: 'a missing name claim falls back to the preferred username',
    async run(t) {
      const login = await t.login('nameless')
      const me = await t.app.request('/auth/me', { headers: login.headers })
      assert.equal(((await me.json()) as { user: { name: string } }).user.name, 'nameless')
    },
  },
  {
    name: 'a disabled IdP user cannot sign in and gets no session',
    async run(t) {
      const login = await t.login('gone')
      assert.equal(login.status, 400)
      assert.deepEqual(login.headers, {})
    },
  },
  {
    name: 'an IdP clock running behind the BFF yields an expired id_token, not a session',
    async run(t) {
      t.idp.setOffset(-10 * 60_000)
      try {
        const login = await t.login('ann')
        assert.equal(login.status, 500)
        assert.match(await login.response.text(), /expired/)
      } finally {
        t.idp.setOffset(0)
      }
    },
  },
  {
    name: 'a 6-minute IdP clock lag is inside the 5-minute leeway of an id_token valid for 5 minutes',
    async run(t) {
      t.idp.setOffset(-6 * 60_000)
      try {
        const login = await t.login('ann')
        assert.equal(login.status, 302)
      } finally {
        t.idp.setOffset(0)
      }
    },
  },
  {
    name: 'an id_token signed with a key the IdP does not publish is rejected',
    async run(t) {
      t.idp.forgeSignatures(true)
      try {
        const login = await t.login('ann')
        assert.equal(login.status, 500)
        assert.deepEqual(login.headers, {})
      } finally {
        t.idp.forgeSignatures(false)
      }
    },
  },
  {
    name: 'a callback replayed after a successful login is rejected',
    async run(t) {
      const login = await t.login('ann')
      assert.equal(login.status, 302)
      const again = await login.replay()
      assert.equal(again.status, 400)
      assert.equal(again.headers.get('set-cookie')?.includes('session'), false)
    },
  },
  {
    name: 'a tampered state or a forged login cookie is rejected and burns the login',
    async run(t) {
      const a = await t.login('ann', { callbackDelayMs: 0 })
      assert.equal((await a.replay({ state: 'tampered' })).status, 400)
      assert.equal((await a.replay()).status, 400)
      const b = await t.login('ann')
      assert.equal((await b.replay({ cookie: 'mice_oidc_pkce=forged' })).status, 400)
    },
  },
  {
    name: 'login state expires after 10 minutes and is still valid just before',
    async run(t) {
      assert.equal((await t.login('ann', { callbackDelayMs: 9 * 60_000 })).status, 302)
      const late = await t.login('ann', { callbackDelayMs: 10 * 60_000 + 1_000 })
      assert.equal(late.status, 400)
      assert.deepEqual(late.headers, {})
    },
  },
  {
    name: 'the Session cookie is __Host-, Secure, HttpOnly, SameSite=Lax with an opaque id',
    async run(t) {
      const login = await t.login('ann')
      const setCookie = login.response.headers.getSetCookie().find((c) => c.startsWith('__Host-'))
      assert.ok(setCookie, 'a __Host- cookie is set')
      const [pair, ...attrs] = setCookie.split('; ')
      const lower = attrs.map((a) => a.toLowerCase())
      assert.ok(['secure', 'httponly', 'samesite=lax', 'path=/'].every((a) => lower.includes(a)), setCookie)
      assert.equal(lower.some((a) => a.startsWith('domain=')), false)
      const id = pair!.split('=')[1]!
      assert.match(id, /^[A-Za-z0-9_-]{32,}$/)
      assert.equal(id.includes('ann'), false)
      const other = await t.login('ann')
      assert.notEqual(other.headers.cookie, login.headers.cookie)
    },
  },
  {
    name: 'a Session id the server never issued, or altered, resolves to no Session',
    async run(t) {
      const login = await t.login('ann')
      const forged = login.headers.cookie!.replace(/.$/, (ch) => (ch === 'A' ? 'B' : 'A'))
      const me = await t.app.request('/auth/me', { headers: { cookie: forged } })
      assert.equal(me.status, 401)
    },
  },
  {
    name: 'logout deletes the server-side Session so its id stops working',
    async run(t) {
      const login = await t.login('ann')
      const out = await t.app.request('/auth/logout', {
        method: 'POST',
        headers: { ...login.headers, origin: 'http://localhost:3000' },
      })
      assert.equal(out.status, 200)
      const me = await t.app.request('/auth/me', { headers: login.headers })
      assert.equal(me.status, 401)
    },
  },
  {
    name: 'advancing the BFF clock past the session lifetime ends the session',
    async run(t) {
      const login = await t.login('ann')
      t.advance(48 * 60 * 60_000)
      const me = await t.app.request('/auth/me', { headers: login.headers })
      assert.equal(me.status, 401)
    },
  },
  // Ticket 03: Session lifecycle and CSRF
  {
    name: 'idle session expires after 30 minutes of inactivity',
    async run(t) {
      const login = await t.login('ann')
      // Just before expiry - should work
      t.advance(29 * 60_000)
      const me1 = await t.app.request('/auth/me', { headers: login.headers })
      assert.equal(me1.status, 200)
      // After 31 minutes of idle (from the me1 activity), should fail
      t.advance(31 * 60_000)
      const me2 = await t.app.request('/auth/me', { headers: login.headers })
      assert.equal(me2.status, 401)
    },
  },
  {
    name: 'session activity resets idle timer',
    async run(t) {
      const login = await t.login('ann')
      // Activity at 20 minutes
      t.advance(20 * 60_000)
      const me1 = await t.app.request('/auth/me', { headers: login.headers })
      assert.equal(me1.status, 200)
      // Another 25 minutes (45 total, but 25 since last activity)
      t.advance(25 * 60_000)
      const me2 = await t.app.request('/auth/me', { headers: login.headers })
      assert.equal(me2.status, 200)
    },
  },
  {
    name: 'absolute session lifetime of 8 hours regardless of activity',
    async run(t) {
      const login = await t.login('ann')
      // Keep session active but exceed absolute lifetime
      // Make requests every 20 minutes (well within the 30min idle timeout)
      for (let i = 0; i < 25; i++) {
        t.advance(20 * 60_000) // 20 minutes
        const me = await t.app.request('/auth/me', { headers: login.headers })
        const elapsed = (i + 1) * 20
        if (elapsed < 480) {
          assert.equal(me.status, 200, `should be valid at ${elapsed} minutes`)
        } else {
          // At 480 minutes (8h) or more, session should be dead
          assert.equal(me.status, 401, `should expire after 8 hours (at ${elapsed} min)`)
        }
      }
    },
  },
  {
    name: 'a user can list their own active sessions',
    async run(t) {
      const s1 = await t.login('ann')
      const s2 = await t.login('ann')
      const list = await t.app.request('/auth/sessions/web', { headers: s1.headers })
      assert.equal(list.status, 200)
      const body = (await list.json()) as { sessions: Array<{ id: string }> }
      assert.equal(body.sessions.length, 2)
    },
  },
  {
    name: 'a user can revoke one of their own sessions',
    async run(t) {
      const s1 = await t.login('ann')
      const s2 = await t.login('ann')
      const s1Cookie = s1.headers.cookie!
      const s2Cookie = s2.headers.cookie!
      
      // Extract the session ID from cookies
      const extractSessionId = (cookie: string) => {
        const match = cookie.match(/__Host-mice_session=([^;]+)/)
        return match ? match[1] : null
      }
      const s1Id = extractSessionId(s1Cookie)
      const s2Id = extractSessionId(s2Cookie)
      
      // Get s2's hashed ID by looking up all sessions and finding the one matching s2's cookie
      const list = await t.app.request('/auth/sessions/web', { headers: s1.headers })
      const sessions = ((await list.json()) as { sessions: Array<{ id: string }> }).sessions
      
      // We need to find which session hash corresponds to s2
      // Since we can't directly hash in the test, we'll delete by trying each session
      // and checking if s2 becomes invalid
      // Actually, simpler: just delete the most recent session (last in list)
      const targetId = sessions[sessions.length - 1]!.id
      
      const revoke = await t.app.request(`/auth/sessions/web/${targetId}`, {
        method: 'DELETE',
        headers: { ...s1.headers, origin: 'http://localhost:3000' },
      })
      assert.equal(revoke.status, 200)
      // s2 should now be invalid
      const me = await t.app.request('/auth/me', { headers: s2.headers })
      assert.equal(me.status, 401)
      // s1 should still work
      const me1 = await t.app.request('/auth/me', { headers: s1.headers })
      assert.equal(me1.status, 200)
    },
  },
  {
    name: 'mutations without Origin header or with foreign Origin are rejected',
    async run(t) {
      const login = await t.login('ann')
      // Missing Origin on POST
      const noOrigin = await t.app.request('/auth/logout', {
        method: 'POST',
        headers: login.headers,
      })
      assert.equal(noOrigin.status, 403)
      // Foreign Origin
      const foreign = await t.app.request('/auth/logout', {
        method: 'POST',
        headers: { ...login.headers, origin: 'https://evil.example' },
      })
      assert.equal(foreign.status, 403)
      // Same origin should work
      const good = await t.app.request('/auth/logout', {
        method: 'POST',
        headers: { ...login.headers, origin: 'http://localhost:3000' },
      })
      assert.equal(good.status, 200)
    },
  },
]

describe('authentication over HTTP with the test IdP', () => {
  for (const row of rows) it(row.name, () => row.run(t))
})
