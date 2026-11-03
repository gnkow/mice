import './db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ensurePrincipal } from './authentication/session/session.js'
import { decideInstanceAction } from './authz.js'
import { assignRole } from './rbacStore.js'
import { writeInstancePermissions } from './authzInstanceStore.js'

const person = (sub: string) => ({
  sub,
  iss: 'https://idp.test',
  email: `${sub}@example.com`,
  emailVerified: true as const,
  name: sub,
})

describe('RBAC S24 instance actions via new permissions', () => {
  it('allows namespace.create for Manager role via namespace:create', async () => {
    const user = person('mgr-ns-create')
    await ensurePrincipal(user)
    assert.equal(
      (await assignRole({ actor: null, target: user, role: 'manager', reason: 'boot', bootstrap: true })).ok,
      true,
    )
    const d = await decideInstanceAction(user, 'namespace.create')
    assert.equal(d.allow, true)
  })

  it('denies namespace.create for External role', async () => {
    const user = person('ext-ns-create')
    await ensurePrincipal(user)
    assert.equal(
      (await assignRole({ actor: null, target: user, role: 'external', reason: 'boot', bootstrap: true })).ok,
      true,
    )
    const d = await decideInstanceAction(user, 'namespace.create')
    assert.equal(d.allow, false)
  })

  it('does not treat legacy create_namespace grants as sufficient', async () => {
    const user = person('legacy-create-ns')
    await ensurePrincipal(user)
    await writeInstancePermissions(user, ['create_namespace'])
    const d = await decideInstanceAction(user, 'namespace.create')
    assert.equal(d.allow, false)
  })

  it('maps audit.view to audit:read (Manager yes, Admin role no)', async () => {
    const manager = person('mgr-audit')
    const admin = person('admin-audit')
    await ensurePrincipal(manager)
    await ensurePrincipal(admin)
    assert.equal(
      (await assignRole({ actor: null, target: manager, role: 'manager', reason: 'boot', bootstrap: true })).ok,
      true,
    )
    assert.equal(
      (await assignRole({ actor: null, target: admin, role: 'admin', reason: 'boot', bootstrap: true })).ok,
      true,
    )
    assert.equal((await decideInstanceAction(manager, 'audit.view')).allow, true)
    assert.equal((await decideInstanceAction(admin, 'audit.view')).allow, false)
  })
})
