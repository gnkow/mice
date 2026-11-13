import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fakeClock, useClock } from '../../clock.js'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-reenable-'))
process.env.SESSION_SECRET = 'test-session-secret-for-reenable'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'admin1@test.com'
process.env.DIRECTORY_PROVIDER = 'keycloak'
process.env.KEYCLOAK_ADMIN_URL = 'http://localhost:8180'
process.env.KEYCLOAK_REALM = 'mice'
process.env.OIDC_CLIENT_ID = 'mice-auth'
process.env.OIDC_CLIENT_SECRET = 'mice-auth-secret'
process.env.OIDC_ISSUER_PUBLIC = 'http://localhost:8180/realms/mice'

const clock = fakeClock(Date.UTC(2026, 0, 1))
const restoreClock = useClock(clock)

const { Hono } = await import('hono')
const { registerReenableRoutes } = await import('./reenableRoutes.js')
const { registerMiceSuspensionRoutes } = await import('./miceSuspensionRoutes.js')
const { authenticate } = await import('../session/requireAuth.js')
const { sealSession } = await import('../session/session.js')
const { sealSessionCookie } = await import('../session/cookieSeal.js')
const { ensureBootstrapKey } = await import('../session/sealKeys.js')
const { env } = await import('../../env.js')
const { maybeBootstrapInstanceAdmin, instancePermissions, writeInstancePermissions } = await import('../../authzInstanceStore.js')
const { setDirectoryFetchForTests } = await import('../directory/directory.js')
const { ensureNamespace, membershipRefs, setMember } = await import('../../authzRepository.js')
const { principalKey } = await import('../session/principal.js')
const { queryAudit } = await import('../../audit.js')
const { createLoginFlow } = await import('../oidc/loginFlow.js')
const { regulatedMutationHeaders } = await import('../../testSupport.js')

const idp = new Map<string, 'enabled' | 'disabled'>()

setDirectoryFetchForTests(async (url) => {
  const urlStr = String(url)
  if (urlStr.includes('/protocol/openid-connect/token')) {
    return new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }), { status: 200 })
  }
  const match = urlStr.match(/\/users\/([^/?]+)/)
  if (match) {
    const sub = decodeURIComponent(match[1]!)
    return new Response(
      JSON.stringify({
        enabled: (idp.get(sub) ?? 'enabled') === 'enabled',
        firstName: 'Ada',
        lastName: 'Lovelace',
      }),
      { status: 200 },
    )
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
  reason = 'Absence exceeded thirty days',
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
  const api = new Hono()
  registerMiceSuspensionRoutes(api, { audit: async () => {} })
  registerReenableRoutes(api, { audit: async () => {} })
  api.get('/x', async (c) => {
    const result = await authenticate(c)
    return result.ok ? c.json({ sub: result.user.sub }) : c.json({ error: result.error }, result.status)
  })
  return api
}

await describe('Principal re-enable after IdP disable', async () => {
  await it('records the first IdP-disabled detection once', async () => {
    const scientist = mk('away')
    const scientistCookie = await cookie(scientist)
    idp.set('away', 'disabled')
    const api = app()

    assert.equal((await api.request('/x', { headers: { cookie: scientistCookie } })).status, 503)
    assert.equal((await api.request('/x', { headers: { cookie: scientistCookie } })).status, 503)

    const listed = await api.request('/auth/admin/re-enable', { headers: { cookie: await cookie(admin) } })
    assert.equal(listed.status, 200, await listed.clone().text())
    assert.deepEqual(await listed.json(), {
      periods: [{
        principal: 'idp|away',
        disabledAt: '2026-01-01T00:00:00.000Z',
        awaitingConfirmation: false,
      }],
    })
  })

  await it('restores access automatically within 30 days and audits the grants that remained', async () => {
    clock.set(Date.UTC(2026, 0, 1))
    const scientist = mk('short')
    const scientistCookie = await cookie(scientist)
    await writeInstancePermissions(scientist, ['view_audit'])
    const scientistKey = principalKey(scientist)
    await ensureNamespace(principalKey(admin), 'lab', 'none')
    assert.equal((await setMember('lab', scientistKey, 'read')).ok, true)

    idp.set('short', 'disabled')
    const api = app()
    assert.equal((await api.request('/x', { headers: { cookie: scientistCookie } })).status, 503)

    clock.advance(2592000000)
    idp.set('short', 'enabled')
    const restored = await api.request('/x', { headers: { cookie: scientistCookie } })
    assert.equal(restored.status, 200, await restored.clone().text())
    assert.deepEqual(await instancePermissions(scientist), ['view_audit'])
    assert.deepEqual(await membershipRefs({ key: scientistKey, groups: [] }, 'lab'), [
      { namespace: 'lab', role: 'read' },
    ])

    const events = (await queryAudit({ action: 'auth.reenable.automatic', limit: 20 })).events
    const event = events.find((entry) => entry.message === 'Restored idp|short')
    assert.ok(event)
    assert.equal(event.detail?.disabledDurationMs, 2592000000)
    assert.equal(event.detail?.restoration, 'automatic')
    assert.deepEqual(event.detail?.grants, ['view_audit'])
    assert.deepEqual(event.detail?.memberships, ['lab:read'])
  })

  await it('blocks a return after more than 30 days and lists it for confirmation', async () => {
    clock.set(Date.UTC(2026, 0, 1))
    const scientist = mk('long')
    const scientistCookie = await cookie(scientist)
    idp.set('long', 'disabled')
    const api = app()
    assert.equal((await api.request('/x', { headers: { cookie: scientistCookie } })).status, 503)

    clock.advance(2592000001)
    idp.set('long', 'enabled')
    const refused = await api.request('/x', { headers: { cookie: scientistCookie } })
    assert.equal(refused.status, 403)
    assert.equal((await refused.json()).error, 'Re-enable confirmation required')

    const listed = await api.request('/auth/admin/re-enable', { headers: { cookie: await cookie(admin) } })
    assert.equal(listed.status, 200, await listed.clone().text())
    const body = await listed.json() as { periods: Array<{ principal: string; awaitingConfirmation: boolean }> }
    const period = body.periods.find((row) => row.principal === 'idp|long')
    assert.deepEqual(
      period && { principal: period.principal, awaitingConfirmation: period.awaitingConfirmation },
      { principal: 'idp|long', awaitingConfirmation: true },
    )
  })

  await it('lets an admin confirm a long disable and audits the confirming Principal', async () => {
    clock.set(Date.UTC(2026, 0, 1))
    const scientist = mk('overdue')
    const scientistCookie = await cookie(scientist)
    await writeInstancePermissions(scientist, ['view_audit'])
    idp.set('overdue', 'disabled')
    const api = app()
    assert.equal((await api.request('/x', { headers: { cookie: scientistCookie } })).status, 503)

    clock.advance(2592000001)
    idp.set('overdue', 'enabled')
    assert.equal((await api.request('/x', { headers: { cookie: scientistCookie } })).status, 403)

    const confirmBody = { principal: 'idp|overdue' }
    const confirmed = await api.request('/auth/admin/re-enable', {
      method: 'POST',
      headers: await signedAdmin('/auth/admin/re-enable', confirmBody),
      body: JSON.stringify(confirmBody),
    })
    assert.equal(confirmed.status, 200, await confirmed.clone().text())

    const restored = await api.request('/x', { headers: { cookie: scientistCookie } })
    assert.equal(restored.status, 200, await restored.clone().text())
    assert.deepEqual(await instancePermissions(scientist), ['view_audit'])

    const events = (await queryAudit({ action: 'auth.reenable.confirmed', limit: 20 })).events
    const event = events.find((entry) => entry.message === 'Confirmed restore of idp|overdue')
    assert.ok(event)
    assert.equal(event.detail?.disabledDurationMs, 2592000001)
    assert.equal(event.detail?.restoration, 'admin-confirmed')
    assert.equal(event.detail?.confirmedBy, 'idp|admin1')
    assert.deepEqual(event.detail?.grants, ['view_audit'])
  })

  await it('does not restore automatically while a Mice suspension flag is set', async () => {
    clock.set(Date.UTC(2026, 0, 1))
    const scientist = mk('flagged')
    const scientistCookie = await cookie(scientist)
    idp.set('flagged', 'disabled')
    const api = app()
    assert.equal((await api.request('/x', { headers: { cookie: scientistCookie } })).status, 503)

    const suspendBody = { principal: 'idp|flagged', reason: 'Absence exceeded thirty days' }
    const suspended = await api.request('/auth/admin/mice-suspension', {
      method: 'POST',
      headers: await signedAdmin('/auth/admin/mice-suspension', suspendBody),
      body: JSON.stringify(suspendBody),
    })
    assert.equal(suspended.status, 200, await suspended.clone().text())

    clock.advance(864000000)
    idp.set('flagged', 'enabled')
    const refused = await api.request('/x', { headers: { cookie: await cookie(scientist) } })
    assert.equal(refused.status, 403)
    assert.equal((await refused.json()).error, 'Suspended')

    const events = (await queryAudit({ action: 'auth.reenable.automatic', limit: 20 })).events
    assert.equal(events.some((entry) => entry.message === 'Restored idp|flagged'), false)

    const listed = await api.request('/auth/admin/re-enable', { headers: { cookie: await cookie(admin) } })
    const body = await listed.json() as { periods: Array<{ principal: string; awaitingConfirmation: boolean }> }
    const period = body.periods.find((row) => row.principal === 'idp|flagged')
    assert.deepEqual(
      period && { principal: period.principal, awaitingConfirmation: period.awaitingConfirmation },
      { principal: 'idp|flagged', awaitingConfirmation: false },
    )
  })

  await it('refuses login when a disable has lasted more than 30 days', async () => {
    clock.set(Date.UTC(2026, 0, 1))
    const disabled = await loginAs('returning', 'disabled')
    assert.equal(disabled.ok, false)
    if (disabled.ok) return
    assert.equal(disabled.status, 403)

    const api = app()
    const listed = await api.request('/auth/admin/re-enable', { headers: { cookie: await cookie(admin) } })
    const during = await listed.json() as { periods: Array<{ principal: string; disabledAt: string }> }
    assert.equal(during.periods.find((row) => row.principal === 'idp|returning')?.disabledAt, '2026-01-01T00:00:00.000Z')

    clock.advance(2592000001)
    const refused = await loginAs('returning', 'enabled')
    assert.equal(refused.ok, false)
    if (refused.ok) return
    assert.equal(refused.status, 403)
    assert.match(refused.html, /Re-enable confirmation required/)
  })
})

async function loginAs(sub: string, status: 'enabled' | 'disabled') {
  const flow = createLoginFlow({
    provider: {
      beginLogin: async (req) => `http://idp.example/auth?state=${req.state}`,
      completeLogin: async () => ({
        sub,
        iss: 'idp',
        email: `${sub}@test.com`,
        name: sub,
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
      userStatus: async () => ({ status, name: sub }),
      searchUsers: async () => [],
      searchGroups: async () => [],
      getUserGroups: async () => [],
    },
  })
  const started = await flow.startLogin('/')
  const state = new URL(started.authorizeUrl).searchParams.get('state')
  return flow.completeLogin({
    code: 'code',
    state: state ?? '',
    pkceCookie: started.pkceCookie,
  })
}

restoreClock()
