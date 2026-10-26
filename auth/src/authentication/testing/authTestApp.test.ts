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
    name: 'advancing the BFF clock past the session lifetime ends the session',
    async run(t) {
      const login = await t.login('ann')
      t.advance(48 * 60 * 60_000)
      const me = await t.app.request('/auth/me', { headers: login.headers })
      assert.equal(me.status, 401)
    },
  },
]

describe('authentication over HTTP with the test IdP', () => {
  for (const row of rows) it(row.name, () => row.run(t))
})
