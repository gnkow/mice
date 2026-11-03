import './db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { isolatedAuth } from './testSupport.js'

const t = isolatedAuth()
after(() => t.restore())

const { authorizeInstanceAction, authorizeManageOwnTokens, authorizeCliDeviceApprove, authorizeStoreAdmin, preparePrincipal } =
  await import('./authz.js')

const admin = t.admin
await preparePrincipal(admin)

/** Actions where Admin holds the mapped permission (S25). */
const ADMIN_ALLOWS = [
  { action: 'tokens.manage' as const, grantRole: 'user' as const, reason: 'Missing permission tokens:create' },
  { action: 'store.admin' as const, grantRole: 'admin' as const, reason: 'Missing permission store:gc' },
]

/** Actions Admin does not hold — Manager/User do (S25 separation). */
const ADMIN_DENIED = [
  { action: 'cli.device.approve' as const, grantRole: 'manager' as const, reason: 'Missing permission cli_device:approve' },
  { action: 'audit.view' as const, grantRole: 'manager' as const, reason: 'Missing permission audit:read' },
  { action: 'lineage.view' as const, grantRole: 'manager' as const, reason: 'Missing permission lineage:read' },
]

describe('authorizeInstanceAction', () => {
  for (const { action, grantRole, reason } of ADMIN_ALLOWS) {
    it(`${action}: Admin and granted role allow, others deny`, async () => {
      const holder = t.person(`holder-${action}`)
      const outsider = t.person(`outsider-${action}`)
      await t.grantRole(holder, grantRole)
      await preparePrincipal(outsider)
      assert.equal((await authorizeInstanceAction(admin, action)).allow, true)
      assert.equal((await authorizeInstanceAction(holder, action)).allow, true)
      assert.deepEqual(await authorizeInstanceAction(outsider, action), { allow: false, reason })
    })
  }

  for (const { action, grantRole, reason } of ADMIN_DENIED) {
    it(`${action}: granted role allows; Admin and outsiders deny`, async () => {
      const holder = t.person(`holder-${action}`)
      const outsider = t.person(`outsider-${action}`)
      await t.grantRole(holder, grantRole)
      await preparePrincipal(outsider)
      assert.deepEqual(await authorizeInstanceAction(admin, action), { allow: false, reason })
      assert.equal((await authorizeInstanceAction(holder, action)).allow, true)
      assert.deepEqual(await authorizeInstanceAction(outsider, action), { allow: false, reason })
    })
  }

  it('store.admin requires an unscoped credential with store:gc', async () => {
    const scopedAdmin = { ...admin, patScopes: [{ namespace: 'x', maxRole: 'read' as const }] }
    assert.equal((await authorizeInstanceAction(admin, 'store.admin')).allow, true)
    assert.deepEqual(await authorizeInstanceAction(scopedAdmin as never, 'store.admin'), {
      allow: false,
      reason: 'Missing permission store:gc',
    })
    assert.equal((await authorizeInstanceAction(t.person('nobody'), 'store.admin')).allow, false)
  })

  it('named wrappers agree with the policy table', async () => {
    const u = t.person('wrapper-user')
    await preparePrincipal(u)
    assert.deepEqual(await authorizeManageOwnTokens(u), await authorizeInstanceAction(u, 'tokens.manage'))
    assert.deepEqual(await authorizeCliDeviceApprove(u), await authorizeInstanceAction(u, 'cli.device.approve'))
    assert.deepEqual(await authorizeStoreAdmin(u), await authorizeInstanceAction(u, 'store.admin'))
  })
})
