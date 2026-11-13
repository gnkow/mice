import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Hono } from 'hono'
import { fakeClock } from '../../clock.js'
import { overrideEnv } from '../../env.js'
import { createLoginFlow } from '../oidc/loginFlow.js'
import { createFakeOidcProvider } from '../oidc/oidcFake.js'
import { createFakeDirectory } from '../directory/directoryFake.js'
import { currentIdpOutage, listIdpOutages, recordIdpCheck } from './idpOutage.js'

const startedAt = Date.UTC(2026, 5, 1)

function unreachableLogin() {
  const clock = fakeClock(startedAt)
  const provider = createFakeOidcProvider({
    claims: {
      sub: 'u1',
      iss: 'https://idp.test',
      email: 'u1@example.com',
      name: 'U One',
      idToken: 'id.token.jwt',
      groups: ['devs'],
      emailVerified: true,
    },
  })
  const directory = createFakeDirectory({
    issuer: 'https://idp.test',
    users: [{ kind: 'user', sub: 'u1', iss: 'https://idp.test', email: 'u1@example.com', name: 'U One' }],
    statuses: { u1: 'enabled' },
  })
  directory.userStatus = async () => ({ status: 'error', name: '' })
  return createLoginFlow({ provider, directory, clock })
}

const stateOf = (authorizeUrl: string) => new URL(authorizeUrl).searchParams.get('state')!

describe('IdP outage incident', () => {
  it('opens one incident when login cannot reach the IdP', async () => {
    const flow = unreachableLogin()
    const started = await flow.startLogin()
    const res = await flow.completeLogin({
      code: 'c',
      state: stateOf(started.authorizeUrl),
      pkceCookie: started.pkceCookie,
      requestId: 'req-idp-outage-1',
    })
    assert.equal(res.ok, false)
    if (res.ok) return
    assert.equal(res.status, 503)
    const incident = await currentIdpOutage()
    assert.ok(incident)
    assert.equal(incident.startedAt, startedAt)
    assert.equal(incident.check, 'login')
    assert.equal(incident.requestId, 'req-idp-outage-1')
    assert.equal(incident.paperProcedure, 'validation-pack:idp-outage')
    assert.equal(incident.endedAt, undefined)
  })

  it('does not open a second incident for another unreachable login', async () => {
    const flow = unreachableLogin()
    const first = await flow.startLogin()
    await flow.completeLogin({
      code: 'c',
      state: stateOf(first.authorizeUrl),
      pkceCookie: first.pkceCookie,
      requestId: 'req-idp-outage-1',
    })
    const second = await flow.startLogin()
    const res = await flow.completeLogin({
      code: 'c',
      state: stateOf(second.authorizeUrl),
      pkceCookie: second.pkceCookie,
      requestId: 'req-idp-outage-2',
    })
    assert.equal(res.ok, false)
    if (res.ok) return
    assert.equal(res.status, 503)
    const incidents = await listIdpOutages()
    assert.equal(incidents.length, 1)
    assert.equal(incidents[0]?.requestId, 'req-idp-outage-1')
  })

  it('closes the incident when the IdP answers', async () => {
    const clock = fakeClock(startedAt)
    const provider = createFakeOidcProvider({
      claims: {
        sub: 'u1',
        iss: 'https://idp.test',
        email: 'u1@example.com',
        name: 'U One',
        idToken: 'id.token.jwt',
        groups: ['devs'],
        emailVerified: true,
      },
    })
    const directory = createFakeDirectory({
      issuer: 'https://idp.test',
      users: [{ kind: 'user', sub: 'u1', iss: 'https://idp.test', email: 'u1@example.com', name: 'U One' }],
      userGroups: { u1: ['devs'] },
      statuses: { u1: 'enabled' },
    })
    directory.userStatus = async () => ({ status: 'error', name: '' })
    const flow = createLoginFlow({ provider, directory, clock })
    const opened = await flow.startLogin()
    await flow.completeLogin({
      code: 'c',
      state: stateOf(opened.authorizeUrl),
      pkceCookie: opened.pkceCookie,
      requestId: 'req-idp-close',
    })
    const open = await currentIdpOutage()
    assert.ok(open)
    clock.advance(5_000)
    directory.userStatus = async () => ({ status: 'enabled', name: 'U One' })
    const answered = await flow.startLogin()
    const res = await flow.completeLogin({
      code: 'c',
      state: stateOf(answered.authorizeUrl),
      pkceCookie: answered.pkceCookie,
      requestId: 'req-idp-answered',
    })
    assert.equal(res.ok, true)
    assert.equal(await currentIdpOutage(), null)
    const closed = (await listIdpOutages()).find((row) => row.requestId === open.requestId)
    assert.equal(closed?.endedAt, startedAt + 5_000)
  })

  it('opens an incident when an authenticated request cannot reach the IdP', async () => {
    const restore = overrideEnv({
      directoryProvider: 'keycloak',
      keycloakAdminUrl: 'http://localhost:8180',
      keycloakRealm: 'mice',
      oidcClientId: 'mice-auth',
      oidcClientSecret: 'mice-auth-secret',
      oidcIssuerPublic: 'http://localhost:8180/realms/mice',
    })
    const { setDirectoryFetchForTests } = await import('../directory/directory.js')
    const { authenticate } = await import('../session/requireAuth.js')
    const { sealSession } = await import('../session/session.js')
    const { sealSessionCookie } = await import('../session/cookieSeal.js')
    const { ensureBootstrapKey } = await import('../session/sealKeys.js')
    const { env } = await import('../../env.js')
    try {
      await ensureBootstrapKey()
      setDirectoryFetchForTests(async () => {
        throw new Error('Network error')
      })
      const now = Math.floor(Date.now() / 1000)
      const sessionId = await sealSession({
        sub: 'session-outage',
        iss: 'https://idp.test',
        email: 'session-outage@example.com',
        name: 'Session Outage',
        sessionStart: now - 30,
      })
      const sealed = await sealSessionCookie(sessionId)
      const app = new Hono()
      app.get('/test', async (c) => {
        const auth = await authenticate(c)
        return auth.ok ? c.json({ allowed: true }) : c.json({ error: auth.error }, auth.status)
      })
      const res = await app.request('/test', {
        headers: { Cookie: `${env.cookieName}=${sealed}`, 'x-request-id': 'req-session-outage' },
      })
      assert.equal(res.status, 503)
      const incident = await currentIdpOutage()
      assert.ok(incident)
      assert.equal(incident.check, 'authenticated-request')
      assert.equal(incident.requestId, 'req-session-outage')
      assert.equal(incident.paperProcedure, 'validation-pack:idp-outage')
    } finally {
      setDirectoryFetchForTests(null)
      restore()
    }
  })

  it('closes the incident when an authenticated request reaches the IdP', async () => {
    const restore = overrideEnv({
      directoryProvider: 'keycloak',
      keycloakAdminUrl: 'http://localhost:8180',
      keycloakRealm: 'mice',
      oidcClientId: 'mice-auth',
      oidcClientSecret: 'mice-auth-secret',
      oidcIssuerPublic: 'http://localhost:8180/realms/mice',
    })
    const { setDirectoryFetchForTests } = await import('../directory/directory.js')
    const { authenticate } = await import('../session/requireAuth.js')
    const { sealSession } = await import('../session/session.js')
    const { sealSessionCookie } = await import('../session/cookieSeal.js')
    const { ensureBootstrapKey } = await import('../session/sealKeys.js')
    const { env } = await import('../../env.js')
    try {
      await ensureBootstrapKey()
      let reachable = false
      setDirectoryFetchForTests(async (url) => {
        if (!reachable) throw new Error('Network error')
        const urlStr = String(url)
        if (urlStr.includes('/protocol/openid-connect/token')) {
          return new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }), { status: 200 })
        }
        if (urlStr.includes('/users/')) {
          return new Response(JSON.stringify({ enabled: true, firstName: 'Ada', lastName: 'Lovelace' }), { status: 200 })
        }
        throw new Error(`Unexpected request: ${urlStr}`)
      })
      const now = Math.floor(Date.now() / 1000)
      const sessionId = await sealSession({
        sub: 'session-recovery',
        iss: 'https://idp.test',
        email: 'session-recovery@example.com',
        name: 'Session Recovery',
        sessionStart: now - 30,
      })
      const sealed = await sealSessionCookie(sessionId)
      const app = new Hono()
      app.get('/test', async (c) => {
        const auth = await authenticate(c)
        return auth.ok ? c.json({ allowed: true }) : c.json({ error: auth.error }, auth.status)
      })
      const headers = { Cookie: `${env.cookieName}=${sealed}`, 'x-request-id': 'req-session-recovery' }
      const down = await app.request('/test', { headers })
      assert.equal(down.status, 503)
      const open = await currentIdpOutage()
      assert.ok(open)
      reachable = true
      const at = Date.now()
      const up = await app.request('/test', { headers: { ...headers, 'x-request-id': 'req-session-up' } })
      assert.equal(up.status, 200)
      assert.equal(await currentIdpOutage(), null)
      const closed = (await listIdpOutages()).find((row) => row.requestId === open.requestId)
      assert.ok(closed?.endedAt !== undefined && closed.endedAt >= at)
    } finally {
      setDirectoryFetchForTests(null)
      restore()
    }
  })

  it('does not open an incident when the IdP reports the account disabled', async () => {
    const restore = overrideEnv({
      directoryProvider: 'keycloak',
      keycloakAdminUrl: 'http://localhost:8180',
      keycloakRealm: 'mice',
      oidcClientId: 'mice-auth',
      oidcClientSecret: 'mice-auth-secret',
      oidcIssuerPublic: 'http://localhost:8180/realms/mice',
    })
    const { setDirectoryFetchForTests } = await import('../directory/directory.js')
    const { authenticate } = await import('../session/requireAuth.js')
    const { sealSession } = await import('../session/session.js')
    const { sealSessionCookie } = await import('../session/cookieSeal.js')
    const { ensureBootstrapKey } = await import('../session/sealKeys.js')
    const { env } = await import('../../env.js')
    try {
      await ensureBootstrapKey()
      setDirectoryFetchForTests(async (url) => {
        const urlStr = String(url)
        if (urlStr.includes('/protocol/openid-connect/token')) {
          return new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }), { status: 200 })
        }
        if (urlStr.includes('/users/')) {
          return new Response(JSON.stringify({ enabled: false, firstName: 'Ada', lastName: 'Lovelace' }), { status: 200 })
        }
        throw new Error(`Unexpected request: ${urlStr}`)
      })
      const before = await listIdpOutages()
      const now = Math.floor(Date.now() / 1000)
      const sessionId = await sealSession({
        sub: 'session-disabled',
        iss: 'https://idp.test',
        email: 'session-disabled@example.com',
        name: 'Session Disabled',
        sessionStart: now - 30,
      })
      const sealed = await sealSessionCookie(sessionId)
      const app = new Hono()
      app.get('/test', async (c) => {
        const auth = await authenticate(c)
        return auth.ok ? c.json({ allowed: true }) : c.json({ error: auth.error }, auth.status)
      })
      const res = await app.request('/test', { headers: { Cookie: `${env.cookieName}=${sealed}` } })
      assert.equal(res.status, 503)
      assert.equal((await listIdpOutages()).length, before.length)
      assert.equal(await currentIdpOutage(), null)
    } finally {
      setDirectoryFetchForTests(null)
      restore()
    }
  })
})

describe('recordIdpCheck', () => {
  it('opens one incident on the first unreachable check and closes it when reachable', async () => {
    if (await currentIdpOutage()) {
      await recordIdpCheck({ reachable: true, at: startedAt })
    }
    const at = Date.UTC(2026, 11, 1)
    await recordIdpCheck({
      reachable: false,
      at,
      check: 'login',
      requestId: 'req-record-1',
    })
    await recordIdpCheck({
      reachable: false,
      at: at + 1000,
      check: 'login',
      requestId: 'req-record-2',
    })
    const open = await currentIdpOutage()
    assert.ok(open)
    assert.equal(open.requestId, 'req-record-1')
    assert.equal(open.paperProcedure, 'validation-pack:idp-outage')
    await recordIdpCheck({ reachable: true, at: at + 5000 })
    assert.equal(await currentIdpOutage(), null)
    const closed = (await listIdpOutages()).find((row) => row.requestId === 'req-record-1')
    assert.equal(closed?.endedAt, at + 5000)
  })
})
