import './db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ensurePrincipal } from './authentication/session/session.js'
import {
  assignRole,
  getCustomPermissions,
  getEffectivePermissions,
  getUserRole,
  grantCustomPermissions,
  hasPermission,
  listPermissionHistory,
  listPermissionSnapshots,
  listRoleHistory,
  revokeCustomPermissions,
  revokeRole,
} from './rbacStore.js'

const dayMs = 24 * 60 * 60 * 1000

const person = (sub: string) => ({
  sub,
  iss: 'https://idp.test',
  email: `${sub}@example.com`,
  name: sub,
})

describe('RBAC S04 assign role', () => {
  it('refuses a delegated role grant without expiresAt', async () => {
    const actor = person('actor-s04')
    const target = person('target-no-expiry')
    await ensurePrincipal(actor)
    await ensurePrincipal(target)
    const result = await assignRole({
      actor,
      target,
      role: 'user',
      reason: 'onboarding',
    })
    assert.equal(result.ok, false)
    if (result.ok) throw new Error('expected failure')
    assert.match(result.error, /expir/i)
    assert.equal(await getUserRole(target), null)
  })

  it('assigns a delegated role with future expiresAt', async () => {
    const actor = person('actor-s04b')
    const target = person('target-user')
    await ensurePrincipal(actor)
    await ensurePrincipal(target)
    const expiresAt = Date.now() + 30 * dayMs
    const result = await assignRole({
      actor,
      target,
      role: 'user',
      reason: 'approved request',
      expiresAt,
    })
    assert.equal(result.ok, true)
    assert.equal(await getUserRole(target), 'user')
  })

  it('allows bootstrap role assign without expiresAt', async () => {
    const target = person('bootstrap-admin')
    await ensurePrincipal(target)
    const result = await assignRole({
      actor: null,
      target,
      role: 'admin',
      reason: 'bootstrap',
      bootstrap: true,
    })
    assert.equal(result.ok, true)
    assert.equal(await getUserRole(target), 'admin')
  })
})

describe('RBAC S05 revoke and replace role', () => {
  it('replaces an active role and appends grant/revoke history', async () => {
    const actor = person('actor-s05')
    const target = person('target-replace')
    await ensurePrincipal(actor)
    await ensurePrincipal(target)
    const expiresAt = Date.now() + 30 * dayMs
    assert.equal(
      (
        await assignRole({
          actor,
          target,
          role: 'user',
          reason: 'first',
          expiresAt,
        })
      ).ok,
      true,
    )
    assert.equal(
      (
        await assignRole({
          actor,
          target,
          role: 'manager',
          reason: 'upgrade',
          expiresAt,
        })
      ).ok,
      true,
    )
    assert.equal(await getUserRole(target), 'manager')
    const history = await listRoleHistory(target)
    assert.deepEqual(
      history.map((h) => ({ role: h.role, action: h.action })),
      [
        { role: 'user', action: 'granted' },
        { role: 'user', action: 'revoked' },
        { role: 'manager', action: 'granted' },
      ],
    )
  })

  it('revokes the active role and records history', async () => {
    const actor = person('actor-s05b')
    const target = person('target-revoke')
    await ensurePrincipal(actor)
    await ensurePrincipal(target)
    assert.equal(
      (
        await assignRole({
          actor,
          target,
          role: 'external',
          reason: 'temp',
          expiresAt: Date.now() + dayMs,
        })
      ).ok,
      true,
    )
    const revoked = await revokeRole({
      actor,
      target,
      reason: 'no longer needed',
    })
    assert.equal(revoked.ok, true)
    assert.equal(await getUserRole(target), null)
    const history = await listRoleHistory(target)
    assert.equal(history.at(-1)?.action, 'revoked')
    assert.equal(history.at(-1)?.role, 'external')
    assert.equal(history.at(-1)?.revokeReason, 'no longer needed')
  })
})

describe('RBAC S06 getUserRole expiry', () => {
  it('treats an expired role as none', async () => {
    const actor = person('actor-s06')
    const target = person('target-expired')
    await ensurePrincipal(actor)
    await ensurePrincipal(target)
    const expiresAt = Date.now() + 60_000
    assert.equal(
      (
        await assignRole({
          actor,
          target,
          role: 'user',
          reason: 'short',
          expiresAt,
        })
      ).ok,
      true,
    )
    assert.equal(await getUserRole(target, expiresAt - 1), 'user')
    assert.equal(await getUserRole(target, expiresAt), null)
  })
})

describe('RBAC S07 role history', () => {
  it('returns grant and revoke rows in order with reasons', async () => {
    const actor = person('actor-s07')
    const target = person('target-history')
    await ensurePrincipal(actor)
    await ensurePrincipal(target)
    assert.equal(
      (
        await assignRole({
          actor,
          target,
          role: 'user',
          reason: 'join',
          expiresAt: Date.now() + dayMs,
        })
      ).ok,
      true,
    )
    assert.equal(
      (await revokeRole({ actor, target, reason: 'left' })).ok,
      true,
    )
    const history = await listRoleHistory(target)
    assert.equal(history.length, 2)
    assert.equal(history[0].action, 'granted')
    assert.equal(history[0].grantReason, 'join')
    assert.equal(history[1].action, 'revoked')
    assert.equal(history[1].revokeReason, 'left')
  })
})

describe('RBAC S08 grant custom permissions', () => {
  it('refuses delegated custom grants without expiresAt', async () => {
    const actor = person('actor-s08')
    const target = person('target-custom-no-exp')
    await ensurePrincipal(actor)
    await ensurePrincipal(target)
    const result = await grantCustomPermissions({
      actor,
      target,
      permissions: ['namespace:create'],
      reason: 'extra',
    })
    assert.equal(result.ok, false)
    if (result.ok) throw new Error('expected failure')
    assert.match(result.error, /expir/i)
    assert.deepEqual(await getCustomPermissions(target), [])
  })

  it('stores custom permissions beyond the role with expiry', async () => {
    const actor = person('actor-s08b')
    const target = person('target-custom')
    await ensurePrincipal(actor)
    await ensurePrincipal(target)
    const expiresAt = Date.now() + 14 * dayMs
    assert.equal(
      (
        await grantCustomPermissions({
          actor,
          target,
          permissions: ['namespace:create', 'store:gc'],
          reason: 'extra capacity',
          expiresAt,
        })
      ).ok,
      true,
    )
    assert.deepEqual(await getCustomPermissions(target), ['namespace:create', 'store:gc'])
  })
})

describe('RBAC S09 revoke custom permissions', () => {
  it('revokes selected custom permissions and appends history', async () => {
    const actor = person('actor-s09')
    const target = person('target-revoke-perm')
    await ensurePrincipal(actor)
    await ensurePrincipal(target)
    const expiresAt = Date.now() + dayMs
    assert.equal(
      (
        await grantCustomPermissions({
          actor,
          target,
          permissions: ['namespace:create', 'store:gc'],
          reason: 'grant both',
          expiresAt,
        })
      ).ok,
      true,
    )
    const revoked = await revokeCustomPermissions({
      actor,
      target,
      permissions: ['store:gc'],
      reason: 'no longer needed',
    })
    assert.equal(revoked.ok, true)
    assert.deepEqual(await getCustomPermissions(target), ['namespace:create'])
    const history = await listPermissionHistory(target)
    assert.deepEqual(
      history.map((h) => ({ permission: h.permission, action: h.action })),
      [
        { permission: 'namespace:create', action: 'granted' },
        { permission: 'store:gc', action: 'granted' },
        { permission: 'store:gc', action: 'revoked' },
      ],
    )
    assert.equal(history.at(-1)?.revokeReason, 'no longer needed')
  })
})

describe('RBAC S10 effective permissions', () => {
  it('merges active role bundle with non-expired custom permissions', async () => {
    const actor = person('actor-s10')
    const target = person('target-effective')
    await ensurePrincipal(actor)
    await ensurePrincipal(target)
    const expiresAt = Date.now() + dayMs
    assert.equal(
      (await assignRole({ actor, target, role: 'external', reason: 'base', expiresAt })).ok,
      true,
    )
    assert.equal(
      (
        await grantCustomPermissions({
          actor,
          target,
          permissions: ['namespace:create'],
          reason: 'extra',
          expiresAt,
        })
      ).ok,
      true,
    )
    const effective = await getEffectivePermissions(target)
    assert.equal(effective.includes('repo:files:read'), true)
    assert.equal(effective.includes('namespace:create'), true)
    assert.equal(effective.includes('repo:files:write'), false)
    assert.equal(await hasPermission(target, 'namespace:create'), true)
    assert.equal(await hasPermission(target, 'repo:files:write'), false)
  })
})

describe('RBAC S11 permission history', () => {
  it('lists grant rows with reasons via the store API', async () => {
    const actor = person('actor-s11')
    const target = person('target-perm-hist')
    await ensurePrincipal(actor)
    await ensurePrincipal(target)
    assert.equal(
      (
        await grantCustomPermissions({
          actor,
          target,
          permissions: ['directory:search'],
          reason: 'need search',
          expiresAt: Date.now() + dayMs,
        })
      ).ok,
      true,
    )
    const history = await listPermissionHistory(target)
    assert.equal(history.length, 1)
    assert.equal(history[0].permission, 'directory:search')
    assert.equal(history[0].action, 'granted')
    assert.equal(history[0].grantReason, 'need search')
  })
})

describe('RBAC S12 permission snapshots', () => {
  it('records a snapshot after role and permission changes', async () => {
    const actor = person('actor-s12')
    const target = person('target-snap')
    await ensurePrincipal(actor)
    await ensurePrincipal(target)
    const expiresAt = Date.now() + dayMs
    assert.equal(
      (await assignRole({ actor, target, role: 'user', reason: 'role', expiresAt })).ok,
      true,
    )
    assert.equal(
      (
        await grantCustomPermissions({
          actor,
          target,
          permissions: ['namespace:create'],
          reason: 'custom',
          expiresAt,
        })
      ).ok,
      true,
    )
    const snaps = await listPermissionSnapshots(target)
    assert.ok(snaps.length >= 2)
    const latest = snaps.at(-1)!
    assert.equal(latest.role, 'user')
    assert.deepEqual(latest.customPermissions, ['namespace:create'])
    assert.equal(latest.effectivePermissions.includes('repo:files:write'), true)
    assert.equal(latest.effectivePermissions.includes('namespace:create'), true)
    assert.equal(latest.snapshotReason, 'permission_grant')
  })
})
