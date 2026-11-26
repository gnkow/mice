/**
 * HTTP integration for Ticket 49 — POST /auth/principals/emails
 * (emailLookupRequest → currentEmailsByAuthor). UI CommitEmail is out of lane.
 * Also covers GET /auth/me group membership (Ticket 18 / #36).
 */
import '../../../../db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { isolatedAuth, sealedSessionCookie } from '../../../src/packages/shared/lib/testSupport.js'

const iso = isolatedAuth({ OXEN_UPSTREAM: 'http://oxen.invalid' })
after(() => iso.restore())

const { Hono } = await import('hono')
const { registerMeRoutes } = await import('../../../src/packages/authentication/lib/session/meRoutes.js')
const { ensurePrincipal } = await import('../../../src/packages/authentication/lib/session/session.js')
const { upsertGroupDisplayNames } = await import('../../../src/packages/authz/lib/groupDisplayStore.js')
const { groupBindingKey } = await import('../../../src/packages/authz/lib/groupBinding.js')

const app = new Hono()
registerMeRoutes(app, { audit: async () => {} })

const alice = { ...iso.person('email-integ-alice'), name: 'Email Alice', email: 'alice@lab.test' }
await iso.grantRole(alice, 'user')
await ensurePrincipal(alice)

describe('GET /auth/me group membership (Ticket 18 / #36)', () => {
  it('returns session groups with display names', async () => {
    const eng = groupBindingKey(alice.iss, 'eng-id')
    const ops = groupBindingKey(alice.iss, 'ops-id')
    await upsertGroupDisplayNames([
      { bindingKey: eng, displayName: 'Engineering', idBased: true },
      { bindingKey: ops, displayName: 'Operations', idBased: true },
    ])
    const cookie = await sealedSessionCookie({
      ...alice,
      groups: [ops, eng],
    } as typeof alice & { groups: string[] })
    const res = await app.request('/auth/me', {
      headers: { cookie },
    })
    assert.equal(res.status, 200)
    const body = (await res.json()) as {
      authenticated: boolean
      user: { groups: Array<{ bindingKey: string; displayName: string }> }
    }
    assert.equal(body.authenticated, true)
    assert.deepEqual(body.user.groups, [
      { bindingKey: eng, displayName: 'Engineering' },
      { bindingKey: ops, displayName: 'Operations' },
    ])
  })

  it('returns an empty groups list when the session has none', async () => {
    const res = await app.request('/auth/me', {
      headers: await iso.sessionHeaders(alice),
    })
    assert.equal(res.status, 200)
    const body = (await res.json()) as {
      user: { groups: unknown[] }
    }
    assert.deepEqual(body.user.groups, [])
  })

  it('POST /auth/me/groups/refresh replaces session groups from the directory', async () => {
    const { createFakeDirectory } = await import('../../../src/packages/authentication/lib/directory/directoryFake.js')
    const { setDirectoryForTests } = await import('../../../src/packages/authentication/lib/directory/directory.js')
    const issuer = alice.iss
    const eng = groupBindingKey(issuer, 'eng-id')
    const ops = groupBindingKey(issuer, 'ops-id')
    // sealedSessionCookie installs a Keycloak fetch mock; set the fake Directory after that.
    const cookie = await sealedSessionCookie({ ...alice, groups: [] } as typeof alice & {
      groups: string[]
    })
    setDirectoryForTests(
      createFakeDirectory({
        configured: true,
        issuer,
        // authenticate still needs a live directory status for /auth/me*
        statuses: { [alice.sub]: 'enabled' },
        users: [{ sub: alice.sub, email: alice.email, name: alice.name, iss: alice.iss }],
        userGroups: { [alice.sub]: ['eng-id', 'ops-id'] },
      }),
    )
    try {
      const res = await app.request('/auth/me/groups/refresh', {
        method: 'POST',
        headers: { cookie, origin: 'http://localhost' },
      })
      assert.equal(res.status, 200)
      const body = (await res.json()) as {
        groups: Array<{ bindingKey: string; displayName: string }>
      }
      assert.deepEqual(body.groups, [
        { bindingKey: eng, displayName: 'eng-id' },
        { bindingKey: ops, displayName: 'ops-id' },
      ])
      const me = await app.request('/auth/me', { headers: { cookie } })
      assert.equal(me.status, 200)
      const meBody = (await me.json()) as {
        user: { groups: Array<{ bindingKey: string; displayName: string }> }
      }
      assert.deepEqual(meBody.user.groups, body.groups)
    } finally {
      setDirectoryForTests(null)
    }
  })
})

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
    const body = (await res.json()) as {
      emails: Record<string, string>
      names: Record<string, string>
    }
    assert.deepEqual(body.emails, { [author]: 'alice@lab.test' })
    assert.deepEqual(body.names, { [author]: 'Email Alice' })
  })

  it('returns empty maps when authors is missing or empty', async () => {
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
      assert.deepEqual(await res.json(), { emails: {}, names: {} })
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
