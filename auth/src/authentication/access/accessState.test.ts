import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { after, afterEach, describe, it } from 'node:test'
import { eq } from 'drizzle-orm'

process.env.AUTHZ_ENFORCE = 'true'
process.env.AUTHZ_DEV_GRANT_ALL = 'false'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'admin@mice.local'
process.env.AUTHZ_REQUIRE_TRAINING = 'false'
process.env.SESSION_SECRET = 'test-secret'
process.env.OXEN_UPSTREAM = 'http://127.0.0.1:3001'
process.env.DIRECTORY_PROVIDER = 'keycloak'
process.env.KEYCLOAK_ADMIN_URL = 'http://localhost:8180'
process.env.KEYCLOAK_REALM = 'mice'
process.env.OIDC_CLIENT_ID = 'mice-auth'
process.env.OIDC_CLIENT_SECRET = 'mice-auth-secret'
process.env.OIDC_ISSUER_PUBLIC = 'http://localhost:8180/realms/mice'

const {
  ACCESS_RESTORE_WINDOW_MS,
  confirmAccessRestore,
  evaluateAccess,
  getAccessState,
  liftAccessFlag,
  setAccessFlag,
} = await import('./accessState.js')
const { setDirectoryFetchForTests } = await import('../directory/directory.js')
const { getDb } = await import('../../db/database.js')
const { authEvents } = await import('../../db/schema.js')
const { principalKey } = await import('../session/principal.js')
const { createNamespaceAuthz } = await import('../../authzNamespaceStore.js')
const { resolveNamespaceRole, setNamespaceMember } = await import('../../authzMembershipStore.js')

const mk = (sub: string) => ({
  sub,
  iss: 'http://localhost:8180/realms/mice',
  email: `${sub}@example.com`,
  name: sub,
})
const admin = { iss: 'test', sub: 'admin', email: 'admin@example.com', name: 'Admin' }
const DAY = 24 * 60 * 60 * 1000

function setIdpStatus(statuses: Record<string, 'enabled' | 'disabled' | 'missing'>) {
  setDirectoryFetchForTests(async (url) => {
    const value = String(url)
    if (value.includes('/protocol/openid-connect/token')) {
      return new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }), { status: 200 })
    }
    const sub = decodeURIComponent(value.split('/users/')[1] ?? '')
    const status = statuses[sub] ?? 'enabled'
    if (status === 'missing') return new Response('{}', { status: 404 })
    return new Response(JSON.stringify({ enabled: status === 'enabled' }), { status: 200 })
  })
}

afterEach(() => setDirectoryFetchForTests(null))
after(() => setDirectoryFetchForTests(null))

describe('ticket 04 access states', () => {
  it('denies a Principal disabled in the IdP and records the first disabled time', async () => {
    const user = mk('as-disabled')
    setIdpStatus({ 'as-disabled': 'disabled' })
    const result = await evaluateAccess(user)
    assert.equal(result.allowed, false)
    if (result.allowed) return
    assert.equal(result.status, 403)
    assert.equal(result.code, 'ACCESS_SUSPENDED')

    const state = await getAccessState(user)
    assert.ok(state.idpDisabledAt)
    assert.equal(state.restoreDeadline?.getTime(), state.idpDisabledAt.getTime() + ACCESS_RESTORE_WINDOW_MS)
  })

  it('denies with 503 when the IdP cannot answer', async () => {
    const result = await evaluateAccess(mk('as-unreachable'), { status: 'error' })
    assert.equal(result.allowed, false)
    if (result.allowed) return
    assert.equal(result.status, 503)
    assert.equal(result.code, 'IDP_UNAVAILABLE')
  })

  it('restores automatically within 30 days, audits the restore, and keeps grants', async () => {
    const user = mk('as-reenabled')
    const start = Date.UTC(2026, 0, 1)
    setIdpStatus({ 'as-reenabled': 'disabled' })
    assert.equal((await evaluateAccess(user, { now: start })).allowed, false)

    await createNamespaceAuthz(admin, 'as-restore-ns', 'none', true)
    await setNamespaceMember('as-restore-ns', user, 'member')

    setIdpStatus({ 'as-reenabled': 'enabled' })
    const restored = await evaluateAccess(user, { now: start + 10 * DAY })
    assert.equal(restored.allowed, true)
    if (restored.allowed) assert.equal(restored.restored, true)

    const state = await getAccessState(user)
    assert.equal(state.idpDisabledAt, null)
    assert.equal(await resolveNamespaceRole('as-restore-ns', user), 'member')

    const events = await getDb()
      .select()
      .from(authEvents)
      .where(eq(authEvents.principalKey, principalKey(user)))
    assert.ok(events.some((e) => e.reason?.startsWith('access.restored')))
  })

  it('needs admin re-confirmation when disabled for more than 30 days', async () => {
    const user = mk('as-long-disabled')
    const start = Date.UTC(2026, 1, 1)
    setIdpStatus({ 'as-long-disabled': 'disabled' })
    await evaluateAccess(user, { now: start })

    setIdpStatus({ 'as-long-disabled': 'enabled' })
    const denied = await evaluateAccess(user, { now: start + 31 * DAY })
    assert.equal(denied.allowed, false)
    if (denied.allowed) return
    assert.equal(denied.code, 'RESTORE_REQUIRES_APPROVAL')
    assert.equal((await getAccessState(user)).restoreRequiresApproval, true)

    assert.equal(await confirmAccessRestore(user, {
      confirmedBy: admin,
      reason: 'returning after long leave, identity checked',
      now: start + 31 * DAY,
    }), true)
    assert.equal((await evaluateAccess(user, { now: start + 31 * DAY })).allowed, true)
  })

  it('suspends access for a Mice flag until an admin lifts it explicitly', async () => {
    const user = mk('as-flagged')
    setIdpStatus({ 'as-flagged': 'enabled' })
    const flagId = await setAccessFlag(user, {
      reason: 'security review',
      createdBy: admin,
      now: Date.UTC(2026, 2, 1),
    })

    const denied = await evaluateAccess(user)
    assert.equal(denied.allowed, false)
    if (denied.allowed) return
    assert.equal(denied.code, 'ACCESS_SUSPENDED')
    assert.match(denied.error, /security|mice/i)

    assert.equal(await liftAccessFlag(user, flagId, {
      liftedBy: admin,
      reason: 'review complete',
      now: Date.UTC(2026, 2, 2),
    }), true)
    assert.equal((await evaluateAccess(user)).allowed, true)
  })

  it('does not auto-restore a short disable while a Mice flag is active', async () => {
    const user = mk('as-flag-and-disabled')
    const start = Date.UTC(2026, 3, 1)
    setIdpStatus({ 'as-flag-and-disabled': 'disabled' })
    await evaluateAccess(user, { now: start })
    const flagId = await setAccessFlag(user, {
      reason: 'security review',
      createdBy: admin,
      now: start + DAY,
    })

    setIdpStatus({ 'as-flag-and-disabled': 'enabled' })
    const stillDenied = await evaluateAccess(user, { now: start + 2 * DAY })
    assert.equal(stillDenied.allowed, false)
    if (stillDenied.allowed) return
    assert.equal(stillDenied.code, 'ACCESS_SUSPENDED')

    await liftAccessFlag(user, flagId, { liftedBy: admin, reason: 'review complete', now: start + 3 * DAY })
    const restored = await evaluateAccess(user, { now: start + 3 * DAY })
    assert.equal(restored.allowed, true)
    if (restored.allowed) assert.equal(restored.restored, true)
  })
})
