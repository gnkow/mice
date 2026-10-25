import './db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fakeClock } from './clock.js'
import { createLoginFlow } from './loginFlow.js'
import { createFakeOidcProvider } from './oidcFake.js'

const identity = {
  sub: 'u1',
  iss: 'https://idp.test',
  email: 'u1@example.com',
  name: 'U One',
  idToken: 'id.token.jwt',
  groups: ['devs'],
  emailVerified: true,
}

function setup(claims: Partial<typeof identity> & { authTime?: number } = {}) {
  const clock = fakeClock(Date.UTC(2026, 5, 1))
  const provider = createFakeOidcProvider({ claims: { ...identity, ...claims } })
  return { clock, provider, flow: createLoginFlow({ provider, clock }) }
}

const stateOf = (cookie: string) => JSON.parse(Buffer.from(cookie, 'base64url').toString()) as { state: string }

describe('login flow over a fake OIDC provider', () => {
  it('begins login through the provider and completes with the claims it returns', async () => {
    const { provider, flow } = setup()
    const started = await flow.startLogin('/jobs')
    assert.equal(provider.lastBegin?.promptLogin, true)
    assert.ok(started.authorizeUrl.startsWith('https://idp.test/authorize'))
    const done = await flow.completeLogin({
      code: 'c',
      state: stateOf(started.pkceCookie).state,
      pkceCookie: started.pkceCookie,
    })
    assert.equal(done.ok, true)
    if (!done.ok) return
    assert.equal(done.dest, '/jobs')
    assert.deepEqual(done.user, {
      sub: 'u1',
      iss: 'https://idp.test',
      email: 'u1@example.com',
      emailVerified: true,
      name: 'U One',
      idToken: 'id.token.jwt',
      groups: ['devs'],
    })
    assert.equal(provider.lastComplete?.code, 'c')
  })

  it('step-up requires a recent authentication judged by the injected clock', async () => {
    const reauth = { maxAge: 60, sub: 'u1', iss: 'https://idp.test' }
    const clockStart = Date.UTC(2026, 5, 1)
    const { clock, flow } = setup({ authTime: Math.floor(clockStart / 1000) - 10 })
    const started = await flow.startLogin('/auth/step-up/x', reauth)
    const input = { code: 'c', state: stateOf(started.pkceCookie).state, pkceCookie: started.pkceCookie }
    assert.equal((await flow.completeLogin(input)).ok, true)
    clock.advance(120_000)
    const late = await flow.completeLogin(input)
    assert.equal(late.ok, false)
  })

  it('reports provider failures as a 500 retry page', async () => {
    const { provider, flow } = setup()
    provider.failCompleteWith(new Error('boom'))
    const started = await flow.startLogin()
    const res = await flow.completeLogin({
      code: 'c',
      state: stateOf(started.pkceCookie).state,
      pkceCookie: started.pkceCookie,
    })
    assert.equal(res.ok, false)
    if (!res.ok) assert.equal(res.status, 500)
  })
})
