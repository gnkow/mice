import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

process.env.SESSION_SECRET = 'test-secret-empty-name'
process.env.OXEN_UPSTREAM = 'http://127.0.0.1:3001'

const { createKeycloakDirectory } = await import('../directory/directoryKeycloak.js')
const { createLoginFlow } = await import('./loginFlow.js')
const { queryAudit } = await import('../../audit.js')

const directory = createKeycloakDirectory(
  {
    adminUrl: 'http://kc.test',
    realm: 'mice',
    clientId: 'mice-auth',
    clientSecret: 'secret',
    issuer: 'http://kc.test/realms/mice',
  },
  {
    fetch: async (input) => {
      const url = String(input)
      if (url.endsWith('/token')) {
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 60 }), { status: 200 })
      }
      if (url.endsWith('/users/qa')) {
        return new Response(
          JSON.stringify({ id: 'qa', username: 'qa', email: 'qa@example.com', enabled: true }),
          { status: 200 },
        )
      }
      if (url.endsWith('/users/ada')) {
        return new Response(
          JSON.stringify({
            id: 'ada',
            username: 'ada',
            email: 'ada@example.com',
            firstName: 'Ada',
            lastName: 'Lovelace',
            enabled: true,
          }),
          { status: 200 },
        )
      }
      return new Response('{}', { status: 404 })
    },
  },
)

await describe('IdP name on the status check', async () => {
  await it('refuses login when the IdP user has no name', async () => {
    const flow = createLoginFlow({
      provider: {
        beginLogin: async (req) => `http://idp.example/auth?state=${req.state}`,
        completeLogin: async () => ({
          sub: 'qa',
          iss: 'idp',
          email: 'qa@example.com',
          name: 'qa',
          idToken: 'secret-token',
          groups: [],
          emailVerified: true,
        }),
        logoutUrl: async () => null,
        verifyJwt: async () => ({}),
      },
      directory,
    })
    const started = await flow.startLogin('/')
    const state = new URL(started.authorizeUrl).searchParams.get('state')
    const result = await flow.completeLogin({
      code: 'auth-code',
      state: state ?? '',
      pkceCookie: started.pkceCookie,
    })

    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.status, 403)
    assert.match(result.html, /no name in the identity provider/)

    const events = (await queryAudit({ action: 'auth.login.failed', limit: 20 })).events
    const event = events.find((item) => item.message === 'Refused login idp|qa')
    assert.ok(event)
    const recorded = JSON.stringify(event)
    assert.equal(recorded.includes('secret-token'), false)
    assert.equal(recorded.includes('auth-code'), false)
  })

  await it('signs in with the name from the IdP status check', async () => {
    const flow = createLoginFlow({
      provider: {
        beginLogin: async (req) => `http://idp.example/auth?state=${req.state}`,
        completeLogin: async () => ({
          sub: 'ada',
          iss: 'idp',
          email: 'ada@example.com',
          name: 'not-the-idp-name',
          idToken: 'secret-token',
          groups: [],
          emailVerified: true,
        }),
        logoutUrl: async () => null,
        verifyJwt: async () => ({}),
      },
      directory,
    })
    const started = await flow.startLogin('/')
    const state = new URL(started.authorizeUrl).searchParams.get('state')
    const result = await flow.completeLogin({
      code: 'auth-code',
      state: state ?? '',
      pkceCookie: started.pkceCookie,
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.user.name, 'Ada Lovelace')
  })
})
