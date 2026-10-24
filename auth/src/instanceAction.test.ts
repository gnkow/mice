import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { createMemoryJsonBackend, useJsonBackend } from './jsonStore.js'

const memory = createMemoryJsonBackend()
const restoreBackend = useJsonBackend(memory)
process.env.AUTH_DATA_DIR = '/mice-memory-data'
process.env.AUTHZ_ENFORCE = 'true'
process.env.AUTHZ_DEV_GRANT_ALL = 'false'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'admin@mice.local'
process.env.AUTHZ_REQUIRE_TRAINING = 'false'
process.env.SESSION_SECRET = 'test-secret'
process.env.OXEN_UPSTREAM = 'http://127.0.0.1:3001'

const { authorizeInstanceAction, authorizeManageOwnTokens, authorizeCliDeviceApprove, authorizeStoreAdmin, preparePrincipal } =
  await import('./authz.js')
const { setInstancePermissions } = await import('./authzInstanceStore.js')

after(() => restoreBackend())

const person = (sub: string) => ({ sub, iss: 'test', email: `${sub}@example.com`, name: sub })
const admin = { sub: 'admin', iss: 'test', email: 'admin@mice.local', name: 'Admin', emailVerified: true }
preparePrincipal(admin)

const ACTIONS = [
  { action: 'tokens.manage', permission: 'manage_own_tokens', reason: 'Missing permission manage_own_tokens' },
  { action: 'cli.device.approve', permission: 'cli_device_approve', reason: 'Missing permission cli_device_approve' },
  { action: 'audit.view', permission: 'view_audit', reason: 'Missing permission view_audit' },
  { action: 'lineage.view', permission: 'view_lineage', reason: 'Missing permission view_lineage' },
] as const

describe('authorizeInstanceAction', () => {
  for (const { action, permission, reason } of ACTIONS) {
    it(`${action}: admin and named permission allow, others deny`, () => {
      const holder = person(`holder-${action}`)
      const outsider = person(`outsider-${action}`)
      preparePrincipal(holder)
      preparePrincipal(outsider)
      setInstancePermissions(admin, holder, [permission])
      assert.equal(authorizeInstanceAction(admin, action).allow, true)
      assert.equal(authorizeInstanceAction(holder, action).allow, true)
      assert.deepEqual(authorizeInstanceAction(outsider, action), { allow: false, reason })
    })
  }

  it('store.admin requires an unscoped instance admin', () => {
    const scopedAdmin = { ...admin, patScopes: ['repo:read'] }
    assert.equal(authorizeInstanceAction(admin, 'store.admin').allow, true)
    assert.deepEqual(authorizeInstanceAction(scopedAdmin as never, 'store.admin'), {
      allow: false,
      reason: 'Requires instance admin',
    })
    assert.equal(authorizeInstanceAction(person('nobody'), 'store.admin').allow, false)
  })

  it('named wrappers agree with the policy table', () => {
    const u = person('wrapper-user')
    preparePrincipal(u)
    assert.deepEqual(authorizeManageOwnTokens(u), authorizeInstanceAction(u, 'tokens.manage'))
    assert.deepEqual(authorizeCliDeviceApprove(u), authorizeInstanceAction(u, 'cli.device.approve'))
    assert.deepEqual(authorizeStoreAdmin(u), authorizeInstanceAction(u, 'store.admin'))
  })
})
