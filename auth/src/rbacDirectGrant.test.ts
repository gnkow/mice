import './db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ensurePrincipal } from './authentication/session/session.js'
import {
  assignRole,
  getCustomPermissions,
  getUserRole,
  listPermissionHistory,
  listRoleHistory,
} from './rbacStore.js'
import {
  applyAuthorizedGrant,
  directGrantPermissions,
  directGrantRole,
} from './rbacDirectGrant.js'

const dayMs = 24 * 60 * 60 * 1000

const person = (sub: string) => ({
  sub,
  iss: 'https://idp.test',
  email: `${sub}@example.com`,
  name: sub,
})

describe('RBAC S21 direct role grant', () => {
  it('lets a manager grant User without creating an access request', async () => {
    const manager = person('direct-mgr')
    const target = person('direct-target-user')
    await ensurePrincipal(manager)
    await ensurePrincipal(target)
    assert.equal(
      (await assignRole({ actor: null, target: manager, role: 'manager', reason: 'boot', bootstrap: true })).ok,
      true,
    )
    const expiresAt = Date.now() + 30 * dayMs
    const result = await directGrantRole({
      actor: manager,
      target,
      role: 'user',
      reason: 'onboard',
      expiresAt,
    })
    assert.equal(result.ok, true)
    assert.equal(await getUserRole(target), 'user')
    const history = await listRoleHistory(target)
    assert.equal(history.some((h) => h.action === 'granted' && h.role === 'user' && h.accessRequestId == null), true)
  })

  it('blocks a manager from directly granting Admin', async () => {
    const manager = person('direct-mgr2')
    const target = person('direct-target-admin')
    await ensurePrincipal(manager)
    await ensurePrincipal(target)
    assert.equal(
      (await assignRole({ actor: null, target: manager, role: 'manager', reason: 'boot', bootstrap: true })).ok,
      true,
    )
    const result = await directGrantRole({
      actor: manager,
      target,
      role: 'admin',
      reason: 'nope',
      expiresAt: Date.now() + dayMs,
    })
    assert.equal(result.ok, false)
    if (result.ok) throw new Error('expected failure')
    assert.match(result.error, /authority|forbidden/i)
    assert.equal(await getUserRole(target), null)
  })

  it('requires expiresAt for delegated direct grants', async () => {
    const admin = person('direct-admin')
    const target = person('direct-no-exp')
    await ensurePrincipal(admin)
    await ensurePrincipal(target)
    assert.equal(
      (await assignRole({ actor: null, target: admin, role: 'admin', reason: 'boot', bootstrap: true })).ok,
      true,
    )
    const result = await directGrantRole({
      actor: admin,
      target,
      role: 'auditor',
      reason: 'compliance',
    })
    assert.equal(result.ok, false)
    if (result.ok) throw new Error('expected failure')
    assert.match(result.error, /expir/i)
  })
})

describe('RBAC S22 direct custom permission grant', () => {
  it('grants custom permissions the actor holds', async () => {
    const manager = person('direct-perm-mgr')
    const target = person('direct-perm-target')
    await ensurePrincipal(manager)
    await ensurePrincipal(target)
    assert.equal(
      (await assignRole({ actor: null, target: manager, role: 'manager', reason: 'boot', bootstrap: true })).ok,
      true,
    )
    const result = await directGrantPermissions({
      actor: manager,
      target,
      permissions: ['namespace:create'],
      reason: 'extra',
      expiresAt: Date.now() + dayMs,
    })
    assert.equal(result.ok, true)
    assert.deepEqual(await getCustomPermissions(target), ['namespace:create'])
  })

  it('blocks granting permissions the actor lacks', async () => {
    const manager = person('direct-perm-mgr2')
    const target = person('direct-perm-blocked')
    await ensurePrincipal(manager)
    await ensurePrincipal(target)
    assert.equal(
      (await assignRole({ actor: null, target: manager, role: 'manager', reason: 'boot', bootstrap: true })).ok,
      true,
    )
    const result = await directGrantPermissions({
      actor: manager,
      target,
      permissions: ['store:gc'],
      reason: 'nope',
      expiresAt: Date.now() + dayMs,
    })
    assert.equal(result.ok, false)
    if (result.ok) throw new Error('expected failure')
    assert.match(result.error, /authority|forbidden/i)
    assert.deepEqual(await getCustomPermissions(target), [])
  })
})

describe('Authorized Grant seam — applyAuthorizedGrant', () => {
  it('grants role and custom permissions in one authorized call', async () => {
    const manager = person('authz-grant-mgr')
    const target = person('authz-grant-target')
    await ensurePrincipal(manager)
    await ensurePrincipal(target)
    assert.equal(
      (await assignRole({ actor: null, target: manager, role: 'manager', reason: 'boot', bootstrap: true })).ok,
      true,
    )
    const expiresAt = Date.now() + 30 * dayMs
    const result = await applyAuthorizedGrant({
      actor: manager,
      target,
      role: 'user',
      permissions: ['namespace:create'],
      reason: 'onboard with extra',
      expiresAt,
      accessRequestId: 'req-authz-1',
    })
    assert.equal(result.ok, true)
    assert.equal(await getUserRole(target), 'user')
    assert.deepEqual(await getCustomPermissions(target), ['namespace:create'])
    const roleGrant = (await listRoleHistory(target)).find(
      (h) => h.action === 'granted' && h.role === 'user',
    )
    assert.equal(roleGrant?.accessRequestId, 'req-authz-1')
  })

  it('rejects when the actor lacks authority for any part of the grant', async () => {
    const manager = person('authz-grant-mgr2')
    const target = person('authz-grant-blocked')
    await ensurePrincipal(manager)
    await ensurePrincipal(target)
    assert.equal(
      (await assignRole({ actor: null, target: manager, role: 'manager', reason: 'boot', bootstrap: true })).ok,
      true,
    )
    const result = await applyAuthorizedGrant({
      actor: manager,
      target,
      role: 'user',
      permissions: ['store:gc'],
      reason: 'nope',
      expiresAt: Date.now() + dayMs,
    })
    assert.equal(result.ok, false)
    if (result.ok) throw new Error('expected failure')
    assert.match(result.error, /authority|forbidden/i)
    assert.equal(await getUserRole(target), null)
    assert.deepEqual(await getCustomPermissions(target), [])
    assert.equal((await listPermissionHistory(target)).length, 0)
  })
})
