/**
 * HTTP integration for Ticket 49 — POST /auth/principals/emails
 * (emailLookupRequest → currentEmailsByAuthor). UI CommitEmail is out of lane.
 */
import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { isolatedAuth } from '../../testSupport.js'

const iso = isolatedAuth({ OXEN_UPSTREAM: 'http://oxen.invalid' })
after(() => iso.restore())

const { Hono } = await import('hono')
const { registerMeRoutes } = await import('./meRoutes.js')
const { ensurePrincipal } = await import('./session.js')

const app = new Hono()
registerMeRoutes(app, { audit: async () => {} })

const alice = { ...iso.person('email-integ-alice'), name: 'Email Alice', email: 'alice@lab.test' }
await iso.grantRole(alice, 'user')
await ensurePrincipal(alice)

describe('Ticket 49 — POST /auth/principals/emails HTTP seam', () => {
  it('returns current emails for known authors and omits unknown', async () => {
    const headers = {
      ...(await iso.sessionHeaders(alice)),
      'content-type': 'application/json',
    }
    const author = `${alice.iss}|${alice.sub}`
    const res = await app.request('/auth/principals/emails', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        authors: [author, `${alice.iss}|missing-person`, 42, null],
      }),
    })
    assert.equal(res.status, 200)
    const body = (await res.json()) as { emails: Record<string, string> }
    assert.deepEqual(body.emails, { [author]: 'alice@lab.test' })
  })

  it('returns an empty map when authors is missing or empty', async () => {
    const headers = {
      ...(await iso.sessionHeaders(alice)),
      'content-type': 'application/json',
    }
    for (const body of [{}, { authors: [] }]) {
      const res = await app.request('/auth/principals/emails', {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })
      assert.equal(res.status, 200)
      assert.deepEqual(await res.json(), { emails: {} })
    }
  })

  it('requires authentication', async () => {
    const res = await app.request('/auth/principals/emails', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ authors: [`${alice.iss}|${alice.sub}`] }),
    })
    assert.equal(res.status, 401)
  })
})
