import './db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

process.env.AUTHZ_BOOTSTRAP_ADMINS = 'admin@mice.local'
process.env.AUTHZ_REQUIRE_TRAINING = 'false'
process.env.SESSION_SECRET = 'test-secret'
process.env.OXEN_UPSTREAM = 'http://127.0.0.1:3001'

const { authorizeInstanceAction, authorizeManageOwnTokens, authorizeCliDeviceApprove, authorizeStoreAdmin, preparePrincipal } =
  await import('./authz.js')
const { setInstancePermissions } = await import('./authzInstanceStore.js')


const person = (sub: string) => ({ sub, iss: 'test', email: `${sub}@example.com`, name: sub })
const admin = { sub: 'admin', iss: 'test', email: 'admin@mice.local', name: 'Admin', emailVerified: true }
await preparePrincipal(admin)

const ACTIONS = [
  { action: 'tokens.manage', permission: 'manage_own_tokens', reason: 'Missing permission manage_own_tokens' },
  { action: 'cli.device.approve', permission: 'cli_device_approve', reason: 'Missing permission cli_device_approve' },
  { action: 'audit.view', permission: 'view_audit', reason: 'Missing permission view_audit' },
  { action: 'lineage.view', permission: 'view_lineage', reason: 'Missing permission view_lineage' },
] as const

describe('authorizeInstanceAction', () => {
  for (const { action, permission, reason } of ACTIONS) {
    it(`${action}: admin and named permission allow, others deny`, async () => {
      const holder = person(`holder-${action}`)
      const outsider = person(`outsider-${action}`)
      await preparePrincipal(holder)
      await preparePrincipal(outsider)
      await setInstancePermissions(admin, holder, [permission])
      assert.equal((await authorizeInstanceAction(admin, action)).allow, true)
      assert.equal((await authorizeInstanceAction(holder, action)).allow, true)
      assert.deepEqual(await authorizeInstanceAction(outsider, action), { allow: false, reason })
    })
  }

  it('store.admin requires an unscoped instance admin', async () => {
    const scopedAdmin = { ...admin, patScopes: ['repo:read'] }
    assert.equal((await authorizeInstanceAction(admin, 'store.admin')).allow, true)
    assert.deepEqual(await authorizeInstanceAction(scopedAdmin as never, 'store.admin'), {
      allow: false,
      reason: 'Requires instance admin',
    })
    assert.equal((await authorizeInstanceAction(person('nobody'), 'store.admin')).allow, false)
  })

  it('named wrappers agree with the policy table', async () => {
    const u = person('wrapper-user')
    await preparePrincipal(u)
    assert.deepEqual(await authorizeManageOwnTokens(u), await authorizeInstanceAction(u, 'tokens.manage'))
    assert.deepEqual(await authorizeCliDeviceApprove(u), await authorizeInstanceAction(u, 'cli.device.approve'))
    assert.deepEqual(await authorizeStoreAdmin(u), await authorizeInstanceAction(u, 'store.admin'))
  })
})
