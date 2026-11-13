import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

import './db/testSchema.js'

const dataDir = mkdtempSync(join(tmpdir(), 'mice-admin-bootstrap-'))

process.env.AUTH_DATA_DIR = dataDir
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'admin@mice.local'
process.env.AUTHZ_REQUIRE_TRAINING = 'false'
process.env.SESSION_SECRET = 'test-secret'
process.env.OXEN_UPSTREAM = 'http://127.0.0.1:3001'

const { decideInstanceAction, NAMESPACE_CREATE_BOOTSTRAP_REFUSAL, preparePrincipal } = await import('./authz.js')
const { assignRole } = await import('./rbacStore.js')

const admin = { sub: 'admin', iss: 'test', email: 'admin@mice.local', emailVerified: true, name: 'Admin' }
const manager = { sub: 'manager', iss: 'test', email: 'manager@example.com', name: 'Manager' }

after(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

await describe('bootstrap namespace creation', async () => {
  await it('tells the admin to grant namespace:create to a manager when no non-admin users exist', async () => {
    await preparePrincipal(admin)
    await assignRole({ actor: null, target: admin, role: 'admin', reason: 'test', bootstrap: true })
    const d = await decideInstanceAction(admin, 'namespace.create')
    assert.equal(d.allow, false)
    assert.equal(d.reason, NAMESPACE_CREATE_BOOTSTRAP_REFUSAL)
  })

  await it('keeps the plain permission message once a non-admin user exists', async () => {
    await preparePrincipal(manager)
    await assignRole({ actor: null, target: manager, role: 'manager', reason: 'test', bootstrap: true })
    const d = await decideInstanceAction(admin, 'namespace.create')
    assert.equal(d.allow === false && d.reason, 'Missing permission namespace:create')
  })
})
