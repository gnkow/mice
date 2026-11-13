import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { fakeClock } from '../../clock.js'
import { createLoginFlow } from './loginFlow.js'
import { createFakeOidcProvider } from './oidcFake.js'
import { createFakeDirectory } from '../directory/directoryFake.js'

const identity = {
  sub: 'u1',
  iss: 'https://idp.test',
  email: 'u1@example.com',
  name: 'U One',
  idToken: 'id.token.jwt',
  groups: ['devs'],
  emailVerified: true,
}

function setup(claims: Partial<typeof identity> & { authTime?: number; groupsOverage?: boolean } = {}) {
  const clock = fakeClock(Date.UTC(2026, 5, 1))
  const provider = createFakeOidcProvider({ claims: { ...identity, ...claims } })
  const directory = createFakeDirectory({ 
    issuer: 'https://idp.test',
    users: [{ kind: 'user', sub: 'u1', iss: 'https://idp.test', email: 'u1@example.com', name: 'U One' }],
    userGroups: { u1: ['devs', 'admins'] },
    statuses: { u1: 'enabled' },
  })
  return { clock, provider, directory, flow: createLoginFlow({ provider, directory, clock }) }
}

const stateOf = (authorizeUrl: string) => new URL(authorizeUrl).searchParams.get('state')!

describe('login flow over a fake OIDC provider', () => {
  it('begins login through the provider and completes with the claims it returns', async () => {
    const { provider, flow } = setup()
    const started = await flow.startLogin('/jobs')
    assert.equal(provider.lastBegin?.promptLogin, true)
    assert.ok(started.authorizeUrl.startsWith('https://idp.test/authorize'))
    const done = await flow.completeLogin({
      code: 'c',
      state: stateOf(started.authorizeUrl),
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
      groups: ['https://idp.test|devs', 'https://idp.test|admins'],
      groupsNameBasedFallback: true,
    })
    assert.equal(provider.lastComplete?.code, 'c')
  })

  it('refuses login when the IdP is unreachable', async () => {
    const { flow, directory } = setup()
    directory.userStatus = async () => ({ status: 'error', name: '' })
    const started = await flow.startLogin()
    const res = await flow.completeLogin({
      code: 'c',
      state: stateOf(started.authorizeUrl),
      pkceCookie: started.pkceCookie,
    })
    assert.equal(res.ok, false)
    if (res.ok) return
    assert.equal(res.status, 503)
    assert.equal(res.surface, 'unreachable')
    assert.match(res.html, /unreachable/)
    const { getDb } = await import('../../db/database.js')
    const { principals, webSessions } = await import('../../db/schema.js')
    const { eq } = await import('drizzle-orm')
    const sessions = await getDb()
      .select({ id: webSessions.idHash })
      .from(webSessions)
      .innerJoin(principals, eq(principals.id, webSessions.principalId))
      .where(eq(principals.sub, 'u1'))
    assert.equal(sessions.length, 0)
  })

  it('refuses login when the Principal is disabled in the IdP', async () => {
    const { flow, directory } = setup()
    directory.userStatus = async () => ({ status: 'disabled', name: 'U One' })
    const started = await flow.startLogin()
    const res = await flow.completeLogin({
      code: 'c',
      state: stateOf(started.authorizeUrl),
      pkceCookie: started.pkceCookie,
    })
    assert.equal(res.ok, false)
    if (res.ok) return
    assert.equal(res.status, 403)
    assert.equal(res.surface, 'disabled')
    assert.match(res.html, /disabled by the administrator/)
  })

  it('refuses login when the Principal is missing from the directory', async () => {
    const { flow, directory } = setup()
    directory.userStatus = async () => ({ status: 'missing', name: '' })
    const started = await flow.startLogin()
    const res = await flow.completeLogin({
      code: 'c',
      state: stateOf(started.authorizeUrl),
      pkceCookie: started.pkceCookie,
    })
    assert.equal(res.ok, false)
    if (res.ok) return
    assert.equal(res.status, 403)
    assert.equal(res.surface, 'missing')
    assert.match(res.html, /not found in the directory/)
  })

  it('step-up requires a recent authentication judged by the injected clock', async () => {
    const reauth = { maxAge: 60, sub: 'u1', iss: 'https://idp.test' }
    const clockStart = Date.UTC(2026, 5, 1)
    const { clock, flow } = setup({ authTime: Math.floor(clockStart / 1000) - 10 })
    const started = await flow.startLogin('/auth/step-up/x', reauth)
    const input = { code: 'c', state: stateOf(started.authorizeUrl), pkceCookie: started.pkceCookie }
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
      state: stateOf(started.authorizeUrl),
      pkceCookie: started.pkceCookie,
    })
    assert.equal(res.ok, false)
    if (!res.ok) assert.equal(res.status, 500)
  })

  it('fetches groups from directory when overage detected', async () => {
    const { flow } = setup({ groupsOverage: true, groups: [] })
    const started = await flow.startLogin()
    const res = await flow.completeLogin({
      code: 'c',
      state: stateOf(started.authorizeUrl),
      pkceCookie: started.pkceCookie,
    })
    assert.equal(res.ok, true)
    if (!res.ok) return
    // Should have fetched groups from directory (devs, admins) instead of using empty array from IdP.
    // Session groups are stored as binding keys (iss|id).
    assert.deepEqual(res.user.groups, ['https://idp.test|devs', 'https://idp.test|admins'])
  })

  it('fails login when overage detected but directory fetch returns empty', async () => {
    const { flow, provider, directory } = setup({ groupsOverage: true, groups: [] })
    // Override directory to return empty groups (simulating fetch failure or no groups)
    directory.getUserGroups = async () => []
    const started = await flow.startLogin()
    const res = await flow.completeLogin({
      code: 'c',
      state: stateOf(started.authorizeUrl),
      pkceCookie: started.pkceCookie,
    })
    assert.equal(res.ok, false)
    if (res.ok) return
    assert.equal(res.status, 500)
    assert.match(res.html, /Group membership could not be determined/)
  })

  it('completes login normally when no overage', async () => {
    const { flow } = setup({ groupsOverage: false, groups: ['devs'] })
    const started = await flow.startLogin()
    const res = await flow.completeLogin({
      code: 'c',
      state: stateOf(started.authorizeUrl),
      pkceCookie: started.pkceCookie,
    })
    assert.equal(res.ok, true)
    if (!res.ok) return
    assert.deepEqual(res.user.groups, ['https://idp.test|devs', 'https://idp.test|admins'])
  })
})
