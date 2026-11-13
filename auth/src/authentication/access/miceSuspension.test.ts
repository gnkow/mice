import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-suspension-'))
process.env.SESSION_SECRET = 'test-session-secret-for-suspension'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'admin1@test.com'
process.env.DIRECTORY_PROVIDER = 'keycloak'
process.env.KEYCLOAK_ADMIN_URL = 'http://localhost:8180'
process.env.KEYCLOAK_REALM = 'mice'
process.env.OIDC_CLIENT_ID = 'mice-auth'
process.env.OIDC_CLIENT_SECRET = 'mice-auth-secret'
process.env.OIDC_ISSUER_PUBLIC = 'http://localhost:8180/realms/mice'

const { Hono } = await import('hono')
const { registerMiceSuspensionRoutes } = await import('./miceSuspensionRoutes.js')
const { authenticate } = await import('../session/requireAuth.js')
const { sealSession } = await import('../session/session.js')
const { sealSessionCookie } = await import('../session/cookieSeal.js')
const { ensureBootstrapKey } = await import('../session/sealKeys.js')
const { env } = await import('../../env.js')
const { maybeBootstrapInstanceAdmin, instancePermissions, writeInstancePermissions } = await import('../../authzInstanceStore.js')
const { setDirectoryFetchForTests } = await import('../directory/directory.js')
const { ensureNamespace, membershipRefs, setMember } = await import('../../authzRepository.js')
const { createLoginFlow } = await import('../oidc/loginFlow.js')
const { principalKey } = await import('../session/principal.js')
const { queryAudit } = await import('../../audit.js')
const { regulatedMutationHeaders } = await import('../../testSupport.js')

setDirectoryFetchForTests(async (url) => {
  const urlStr = String(url)
  if (urlStr.includes('/protocol/openid-connect/token')) {
    return new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }), { status: 200 })
  }
  if (urlStr.includes('/users/')) {
    return new Response(JSON.stringify({ enabled: true, firstName: 'Ada', lastName: 'Lovelace' }), { status: 200 })
  }
  throw new Error(`Unexpected request: ${urlStr}`)
})

const mk = (sub: string) => ({
  sub,
  iss: 'idp',
  email: `${sub}@test.com`,
  name: sub,
})

const admin = { ...mk('admin1'), emailVerified: true }
await maybeBootstrapInstanceAdmin(admin)
await ensureBootstrapKey()

const cookie = async (user: ReturnType<typeof mk>) => {
  const sessionId = await sealSession({ ...user, sessionStart: Math.floor(Date.now() / 1000) - 30 })
  return `${env.cookieName}=${await sealSessionCookie(sessionId)}`
}

async function signedAdmin(
  path: string,
  body: Record<string, unknown>,
  reason = 'Investigation hold',
) {
  return {
    cookie: await cookie(admin),
    ...(await regulatedMutationHeaders(admin, {
      method: 'POST',
      path,
      body,
      reason,
      category: 'privileged_settings',
    })),
  }
}

function app() {
  const app = new Hono()
  registerMiceSuspensionRoutes(app, { audit: async () => {} })
  app.get('/x', async (c) => {
    const result = await authenticate(c)
    return result.ok ? c.json({ sub: result.user.sub }) : c.json({ error: result.error }, result.status)
  })
  return app
}

await describe('Mice suspension flags', async () => {
  await it('refuses an authenticated request while the IdP user is enabled', async () => {
    const scientist = mk('held')
    await cookie(scientist)
    const api = app()
    const body = { principal: 'idp|held', reason: 'Investigation hold' }

    const set = await api.request('/auth/admin/mice-suspension', {
      method: 'POST',
      headers: await signedAdmin('/auth/admin/mice-suspension', body),
      body: JSON.stringify(body),
    })
    assert.equal(set.status, 200, await set.text())

    const refused = await api.request('/x', { headers: { cookie: await cookie(scientist) } })
    assert.equal(refused.status, 403)
    assert.equal((await refused.json()).error, 'Suspended')
  })

  await it('ends the Session and leaves grants in place', async () => {
    const scientist = mk('paused')
    const scientistCookie = await cookie(scientist)
    await writeInstancePermissions(scientist, ['view_audit'])
    const adminKey = principalKey(admin)
    const scientistKey = principalKey(scientist)
    await ensureNamespace(adminKey, 'lab-hold', 'none')
    assert.equal((await setMember('lab-hold', scientistKey, 'read')).ok, true)

    const api = app()
    const body = { principal: 'idp|paused', reason: 'Investigation hold' }
    const set = await api.request('/auth/admin/mice-suspension', {
      method: 'POST',
      headers: await signedAdmin('/auth/admin/mice-suspension', body),
      body: JSON.stringify(body),
    })
    assert.equal(set.status, 200, await set.text())

    const session = await api.request('/x', { headers: { cookie: scientistCookie } })
    assert.equal(session.status, 401)
    assert.deepEqual(await instancePermissions(scientist), ['view_audit'])
    assert.deepEqual(await membershipRefs({ key: scientistKey, groups: [] }, 'lab-hold'), [
      { namespace: 'lab-hold', role: 'read' },
    ])
  })

  await it('restores access on the next login without recreating grants', async () => {
    const scientist = mk('returned')
    await cookie(scientist)
    await writeInstancePermissions(scientist, ['view_audit'])
    const api = app()
    const setBody = { principal: 'idp|returned', reason: 'Investigation hold' }
    const set = await api.request('/auth/admin/mice-suspension', {
      method: 'POST',
      headers: await signedAdmin('/auth/admin/mice-suspension', setBody),
      body: JSON.stringify(setBody),
    })
    assert.equal(set.status, 200, await set.text())

    const liftBody = { principal: 'idp|returned', reason: 'Investigation closed' }
    const lift = await api.request('/auth/admin/mice-suspension/lift', {
      method: 'POST',
      headers: await signedAdmin('/auth/admin/mice-suspension/lift', liftBody, 'Investigation closed'),
      body: JSON.stringify(liftBody),
    })
    assert.equal(lift.status, 200, await lift.text())

    const next = await api.request('/x', { headers: { cookie: await cookie(scientist) } })
    assert.equal(next.status, 200)
    assert.deepEqual(await instancePermissions(scientist), ['view_audit'])
  })

  await it('refuses login while the IdP user is enabled', async () => {
    const scientist = mk('blocked-login')
    await cookie(scientist)
    const api = app()
    const body = { principal: 'idp|blocked-login', reason: 'Investigation hold' }
    const set = await api.request('/auth/admin/mice-suspension', {
      method: 'POST',
      headers: await signedAdmin('/auth/admin/mice-suspension', body),
      body: JSON.stringify(body),
    })
    assert.equal(set.status, 200, await set.text())

    const flow = createLoginFlow({
      provider: {
        beginLogin: async (req) => `http://idp.example/auth?state=${req.state}`,
        completeLogin: async () => ({
          sub: 'blocked-login',
          iss: 'idp',
          email: 'blocked-login@test.com',
          name: 'blocked-login',
          idToken: 'token',
          groups: [],
          emailVerified: true,
        }),
        logoutUrl: async () => null,
        verifyJwt: async () => ({}),
      },
      directory: {
        configured: true,
        issuer: 'idp',
        userStatus: async () => ({ status: 'enabled' as const, name: 'Held User' }),
        searchUsers: async () => [],
        searchGroups: async () => [],
        getUserGroups: async () => [],
      },
    })
    const started = await flow.startLogin('/')
    const state = new URL(started.authorizeUrl).searchParams.get('state')
    const result = await flow.completeLogin({
      code: 'code',
      state: state ?? '',
      pkceCookie: started.pkceCookie,
    })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.status, 403)
    assert.match(result.html, /Suspended/)
  })

  await it('records set and lift with reason, actor, and time', async () => {
    const scientist = mk('recorded')
    await cookie(scientist)
    const api = app()
    const setBody = { principal: 'idp|recorded', reason: 'Investigation hold' }
    assert.equal((await api.request('/auth/admin/mice-suspension', {
      method: 'POST',
      headers: await signedAdmin('/auth/admin/mice-suspension', setBody),
      body: JSON.stringify(setBody),
    })).status, 200)
    const liftBody = { principal: 'idp|recorded', reason: 'Investigation closed' }
    assert.equal((await api.request('/auth/admin/mice-suspension/lift', {
      method: 'POST',
      headers: await signedAdmin('/auth/admin/mice-suspension/lift', liftBody, 'Investigation closed'),
      body: JSON.stringify(liftBody),
    })).status, 200)

    const res = await api.request('/auth/admin/mice-suspension?principal=idp|recorded', {
      headers: { cookie: await cookie(admin) },
    })
    assert.equal(res.status, 200, await res.clone().text())
    const body = await res.json() as {
      history: Array<{ flag: string; action: string; reason: string; actor: string; at: string }>
    }
    assert.deepEqual(body.history.map((row) => ({
      flag: row.flag,
      action: row.action,
      reason: row.reason,
      actor: row.actor,
    })), [
      { flag: 'suspended', action: 'set', reason: 'Investigation hold', actor: 'idp|admin1' },
      { flag: 'suspended', action: 'lift', reason: 'Investigation closed', actor: 'idp|admin1' },
    ])
    assert.equal(Number.isNaN(Date.parse(body.history[0]!.at)), false)
    assert.equal(Number.isNaN(Date.parse(body.history[1]!.at)), false)
  })

  await it('audits set, lift, and a refused request', async () => {
    const scientist = mk('audited')
    const api = app()
    const missingBody = { principal: 'idp|audited', reason: 'Investigation hold' }
    assert.equal((await api.request('/auth/admin/mice-suspension', {
      method: 'POST',
      headers: await signedAdmin('/auth/admin/mice-suspension', missingBody),
      body: JSON.stringify(missingBody),
    })).status, 404)

    await cookie(scientist)
    assert.equal((await api.request('/auth/admin/mice-suspension', {
      method: 'POST',
      headers: await signedAdmin('/auth/admin/mice-suspension', missingBody),
      body: JSON.stringify(missingBody),
    })).status, 200)
    const liftBody = { principal: 'idp|audited', reason: 'Investigation closed' }
    assert.equal((await api.request('/auth/admin/mice-suspension/lift', {
      method: 'POST',
      headers: await signedAdmin('/auth/admin/mice-suspension/lift', liftBody, 'Investigation closed'),
      body: JSON.stringify(liftBody),
    })).status, 200)
    assert.equal((await api.request('/auth/admin/mice-suspension', {
      method: 'POST',
      headers: await signedAdmin('/auth/admin/mice-suspension', missingBody),
      body: JSON.stringify(missingBody),
    })).status, 200)

    const denied = await api.request('/x', { headers: { cookie: await cookie(scientist) } })
    assert.equal(denied.status, 403)

    const set = (await queryAudit({ action: 'admin.mice_suspension.set', limit: 20 })).events
    const lift = (await queryAudit({ action: 'admin.mice_suspension.lift', limit: 20 })).events
    const refused = (await queryAudit({ action: 'auth.suspended', limit: 20 })).events
    assert.equal(set.some((e) => e.message === 'Suspended idp|audited'), true)
    assert.equal(lift.some((e) => e.message === 'Lifted suspension of idp|audited'), true)
    assert.equal(refused.some((e) => e.message === 'Refused idp|audited'), true)
  })

  await it('audits a refused login', async () => {
    const scientist = mk('login-audit')
    await cookie(scientist)
    const api = app()
    const body = { principal: 'idp|login-audit', reason: 'Investigation hold' }
    assert.equal((await api.request('/auth/admin/mice-suspension', {
      method: 'POST',
      headers: await signedAdmin('/auth/admin/mice-suspension', body),
      body: JSON.stringify(body),
    })).status, 200)

    const flow = createLoginFlow({
      provider: {
        beginLogin: async (req) => `http://idp.example/auth?state=${req.state}`,
        completeLogin: async () => ({
          sub: 'login-audit',
          iss: 'idp',
          email: 'login-audit@test.com',
          name: 'login-audit',
          idToken: 'token',
          groups: [],
          emailVerified: true,
        }),
        logoutUrl: async () => null,
        verifyJwt: async () => ({}),
      },
      directory: {
        configured: true,
        issuer: 'idp',
        userStatus: async () => ({ status: 'enabled' as const, name: 'Held User' }),
        searchUsers: async () => [],
        searchGroups: async () => [],
        getUserGroups: async () => [],
      },
    })
    const started = await flow.startLogin('/')
    const state = new URL(started.authorizeUrl).searchParams.get('state')
    const result = await flow.completeLogin({
      code: 'code',
      state: state ?? '',
      pkceCookie: started.pkceCookie,
    })
    assert.equal(result.ok, false)
    const refused = (await queryAudit({ action: 'auth.suspended', limit: 20 })).events
    assert.equal(refused.some((e) => e.message === 'Refused login idp|login-audit'), true)
  })
})
