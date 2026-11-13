import './db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

process.env.AUTHZ_BOOTSTRAP_ADMINS = 'admin@mice.local'
process.env.AUTHZ_REQUIRE_TRAINING = 'false'
process.env.SESSION_SECRET = 'test-secret'
process.env.OXEN_UPSTREAM = 'http://127.0.0.1:3001'

const { preparePrincipal } = await import('./authz.js')
const {
  hasInstancePermission,
  listInstancePermissionGrants,
  revokeExpiredInstancePermissions,
  setInstancePermissions,
  writeInstancePermissions,
} = await import('./authzInstanceStore.js')
const {
  runInstancePermissionExpiry,
  startInstancePermissionExpirySchedule,
} = await import('./instancePermissionExpiry.js')

await describe('runInstancePermissionExpiry', async () => {
  await it('audits each revoked grant through the expiry seam', async () => {
    const audited: Array<{ action: string; message: string; detail: Record<string, unknown> }> = []
    const revoked = await runInstancePermissionExpiry({
      now: 1_700_000_000_000,
      revoke: async () => [
        {
          sub: 'expired-user',
          iss: 'test',
          permissions: ['view_audit'],
          expiresAt: 1_699_999_999_000,
        },
      ],
      audit: async (event) => {
        audited.push(event)
      },
    })
    assert.equal(revoked.length, 1)
    assert.equal(revoked[0]!.sub, 'expired-user')
    assert.equal(audited.length, 1)
    assert.equal(audited[0]!.action, 'instance.permissions.expire')
    assert.match(audited[0]!.message, /expired-user/)
    assert.deepEqual(audited[0]!.detail.target, { sub: 'expired-user', iss: 'test' })
    assert.deepEqual(audited[0]!.detail.permissions, ['view_audit'])
    assert.equal(audited[0]!.detail.expiresAt, 1_699_999_999_000)
  })

  await it('skips audit when nothing was revoked', async () => {
    let calls = 0
    const revoked = await runInstancePermissionExpiry({
      now: 1,
      revoke: async () => [],
      audit: async () => {
        calls += 1
      },
    })
    assert.equal(revoked.length, 0)
    assert.equal(calls, 0)
  })

  await it('passes now into the revoke adapter', async () => {
    const seen: number[] = []
    await runInstancePermissionExpiry({
      now: 42,
      revoke: async (at) => {
        seen.push(at)
        return []
      },
    })
    assert.deepEqual(seen, [42])
  })
})

const admin = {
  sub: 'admin',
  iss: 'test',
  email: 'admin@mice.local',
  emailVerified: true,
  name: 'Admin',
}
await preparePrincipal(admin)

const person = (sub: string) => ({
  sub,
  iss: 'test',
  email: `${sub}@example.com`,
  name: sub,
})

const dayMs = 24 * 60 * 60 * 1000

await describe('instance permission grant expiry', async () => {
  await it('refuses a delegated grant without expiresAt', async () => {
    const target = person('no-expiry')
    await preparePrincipal(target)
    const result = await setInstancePermissions(admin, target, ['view_audit'])
    assert.equal(result.ok, false)
    if (result.ok) throw new Error('expected failure')
    assert.match(result.error, /expir/i)
    assert.equal(await hasInstancePermission(target, 'view_audit'), false)
  })

  await it('refuses a delegated grant with a past expiresAt', async () => {
    const target = person('past-expiry')
    await preparePrincipal(target)
    const result = await setInstancePermissions(admin, target, ['view_audit'], Date.now() - dayMs)
    assert.equal(result.ok, false)
    if (result.ok) throw new Error('expected failure')
    assert.match(result.error, /expir/i)
    assert.equal(await hasInstancePermission(target, 'view_audit'), false)
  })

  await it('stores a future expiresAt and lists it on the grant', async () => {
    const target = person('future-expiry')
    await preparePrincipal(target)
    const expiresAt = Date.now() + 7 * dayMs
    const result = await setInstancePermissions(admin, target, ['view_audit'], expiresAt)
    assert.equal(result.ok, true)
    assert.equal(await hasInstancePermission(target, 'view_audit'), true)
    const grants = await listInstancePermissionGrants()
    const row = grants.find((g) => g.sub === target.sub && g.iss === target.iss)
    assert.ok(row)
    assert.deepEqual(row.permissions, ['view_audit'])
    assert.equal(row.expiresAt, expiresAt)
  })

  await it('stops treating the grant as effective after expiresAt', async () => {
    const target = person('soft-expiry')
    await preparePrincipal(target)
    const expiresAt = Date.now() + 60_000
    assert.equal(
      (await setInstancePermissions(admin, target, ['create_namespace'], expiresAt)).ok,
      true,
    )
    assert.equal(await hasInstancePermission(target, 'create_namespace', expiresAt - 1), true)
    assert.equal(await hasInstancePermission(target, 'create_namespace', expiresAt), false)
  })

  await it('allows clearing grants without expiresAt', async () => {
    const target = person('clear-grant')
    await preparePrincipal(target)
    assert.equal(
      (await setInstancePermissions(admin, target, ['view_lineage'], Date.now() + dayMs)).ok,
      true,
    )
    const cleared = await setInstancePermissions(admin, target, [])
    assert.equal(cleared.ok, true)
    assert.equal(await hasInstancePermission(target, 'view_lineage'), false)
  })

  await it('revokes expired grants and leaves future ones', async () => {
    const expired = person('revoked-expired')
    const active = person('still-active')
    await preparePrincipal(expired)
    await preparePrincipal(active)
    const now = Date.now()
    await writeInstancePermissions(expired, ['view_audit'], now - 1)
    await writeInstancePermissions(active, ['view_lineage'], now + dayMs)
    const revoked = await revokeExpiredInstancePermissions(now)
    assert.equal(revoked.length, 1)
    assert.equal(revoked[0]!.sub, expired.sub)
    assert.deepEqual(revoked[0]!.permissions, ['view_audit'])
    assert.equal(await hasInstancePermission(expired, 'view_audit', now), false)
    assert.equal(await hasInstancePermission(active, 'view_lineage', now), true)
    const grants = await listInstancePermissionGrants()
    assert.equal(grants.some((g) => g.sub === expired.sub), false)
    assert.equal(grants.some((g) => g.sub === active.sub), true)
  })

  await it('schedule tick revokes expired grants and audits', async () => {
    const target = person('schedule-revoke')
    await preparePrincipal(target)
    const now = Date.now()
    await writeInstancePermissions(target, ['create_namespace'], now - 1)
    const audited: Array<{ action: string; detail?: unknown }> = []
    const schedule = startInstancePermissionExpirySchedule({
      now: () => now,
      poll: false,
      audit: async (event) => {
        audited.push(event)
      },
    })
    assert.equal(await schedule.tick(), true)
    assert.equal(await hasInstancePermission(target, 'create_namespace', now), false)
    assert.equal(audited.length, 1)
    assert.equal(audited[0]!.action, 'instance.permissions.expire')
    schedule.stop()
  })
})
