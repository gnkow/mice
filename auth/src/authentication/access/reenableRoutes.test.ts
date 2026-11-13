/**
 * Route integration for Principal re-enable admin APIs (Ticket 27).
 * Exercises `registerReenableRoutes` without requireAuth / loginFlow / miceSuspension.
 */

import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { fakeClock, useClock } from '../../clock.js'

process.env.AUTH_DATA_DIR = mkdtempSync(join(tmpdir(), 'mice-reenable-routes-'))
process.env.SESSION_SECRET = 'test-session-secret-for-reenable-routes'
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
const { recordIdpDisabled, REENABLE_WINDOW_MS } = await import('./reenable.js')
const { sealSession } = await import('../session/session.js')
const { sealSessionCookie } = await import('../session/cookieSeal.js')
const { ensureBootstrapKey } = await import('../session/sealKeys.js')
const { env } = await import('../../env.js')
const { maybeBootstrapInstanceAdmin } = await import('../../authzInstanceStore.js')
const { setDirectoryFetchForTests } = await import('../directory/directory.js')
const { queryAudit } = await import('../../audit.js')
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

const cookie = async (user: ReturnType<typeof mk> = admin) => {
  const sessionId = await sealSession({ ...user, sessionStart: Math.floor(Date.now() / 1000) - 30 })
  return `${env.cookieName}=${await sealSessionCookie(sessionId)}`
}

async function signedAdmin(path: string, body: Record<string, unknown>) {
  return {
    cookie: await cookie(admin),
    ...(await regulatedMutationHeaders(admin, {
      method: 'POST',
      path,
      body,
      reason: 'Absence exceeded thirty days',
      category: 'privileged_settings',
    })),
  }
}

function app() {
  const api = new Hono()
  registerReenableRoutes(api, { audit: async () => {} })
  return api
}

await describe('reenableRoutes', async () => {
  await it('rejects unauthenticated list and confirm', async () => {
    const api = app()
    assert.equal((await api.request('/auth/admin/re-enable')).status, 401)
    assert.equal(
      (await api.request('/auth/admin/re-enable', { method: 'POST', body: '{}' })).status,
      401,
    )
  })

  await it('lists an open disable and flags confirmation only past the window when IdP-enabled', async () => {
    clock.set(Date.UTC(2026, 0, 1))
    const scientist = mk('listed')
    idp.set('listed', 'disabled')
    await recordIdpDisabled(scientist)

    const api = app()
    const early = await api.request('/auth/admin/re-enable', { headers: { cookie: await cookie() } })
    assert.equal(early.status, 200, await early.clone().text())
    const earlyBody = await early.json() as {
      periods: Array<{ principal: string; disabledAt: string; awaitingConfirmation: boolean }>
    }
    const earlyRow = earlyBody.periods.find((p) => p.principal === 'idp|listed')
    assert.deepEqual(earlyRow, {
      principal: 'idp|listed',
      disabledAt: '2026-01-01T00:00:00.000Z',
      awaitingConfirmation: false,
    })

    clock.advance(REENABLE_WINDOW_MS + 1)
    idp.set('listed', 'enabled')
    const due = await api.request('/auth/admin/re-enable', { headers: { cookie: await cookie() } })
    assert.equal(due.status, 200, await due.clone().text())
    const dueBody = await due.json() as {
      periods: Array<{ principal: string; awaitingConfirmation: boolean }>
    }
    assert.deepEqual(
      dueBody.periods.find((p) => p.principal === 'idp|listed'),
      { principal: 'idp|listed', awaitingConfirmation: true, disabledAt: '2026-01-01T00:00:00.000Z' },
    )
  })

  await it('lets an admin confirm a long disable and audits the confirmer', async () => {
    clock.set(Date.UTC(2026, 0, 1))
    const scientist = mk('confirm-me')
    idp.set('confirm-me', 'disabled')
    await recordIdpDisabled(scientist)

    clock.advance(REENABLE_WINDOW_MS + 1)
    idp.set('confirm-me', 'enabled')

    const api = app()
    const confirmBody = { principal: 'idp|confirm-me' }
    const confirmed = await api.request('/auth/admin/re-enable', {
      method: 'POST',
      headers: await signedAdmin('/auth/admin/re-enable', confirmBody),
      body: JSON.stringify(confirmBody),
    })
    assert.equal(confirmed.status, 200, await confirmed.clone().text())
    assert.deepEqual(await confirmed.json(), { ok: true })

    const listed = await api.request('/auth/admin/re-enable', { headers: { cookie: await cookie() } })
    const body = await listed.json() as { periods: Array<{ principal: string }> }
    assert.equal(body.periods.some((p) => p.principal === 'idp|confirm-me'), false)

    const events = (await queryAudit({ action: 'auth.reenable.confirmed', limit: 20 })).events
    const event = events.find((entry) => entry.message === 'Confirmed restore of idp|confirm-me')
    assert.ok(event)
    assert.equal(event.detail?.restoration, 'admin-confirmed')
    assert.equal(event.detail?.confirmedBy, 'idp|admin1')
  })

  await it('rejects invalid principal format and confirmation that is not due', async () => {
    clock.set(Date.UTC(2026, 0, 1))
    const scientist = mk('not-due')
    idp.set('not-due', 'disabled')
    await recordIdpDisabled(scientist)

    const api = app()
    const bad = { principal: 'no-bar' }
    const badRes = await api.request('/auth/admin/re-enable', {
      method: 'POST',
      headers: await signedAdmin('/auth/admin/re-enable', bad),
      body: JSON.stringify(bad),
    })
    assert.equal(badRes.status, 400)

    const earlyBody = { principal: 'idp|not-due' }
    const early = await api.request('/auth/admin/re-enable', {
      method: 'POST',
      headers: await signedAdmin('/auth/admin/re-enable', earlyBody),
      body: JSON.stringify(earlyBody),
    })
    assert.equal(early.status, 409)
    assert.equal((await early.json()).error, 'Re-enable confirmation is not due')
  })
})

restoreClock()
