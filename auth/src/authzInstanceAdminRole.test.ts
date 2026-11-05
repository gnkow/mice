import './db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

process.env.AUTHZ_BOOTSTRAP_ADMINS = 'boot-admin@example.com'
const { assignRole, getUserRole } = await import('./rbacStore.js')
const { instancePermissions, isInstanceAdmin, listInstanceAdmins, maybeBootstrapInstanceAdmin } = await import('./authzInstanceStore.js')
const { userHasAnyGrant } = await import('./authzVisibility.js')

const person = (sub: string) => ({ sub, iss: 'https://idp.test', email: `${sub}@example.com`, emailVerified: true as const, name: sub })
const give = (u: ReturnType<typeof person>, role: 'admin' | 'manager') =>
  assignRole({ actor: null, target: u, role, reason: 'test', bootstrap: true })

describe('Instance admin is the Admin role (#20)', () => {
  it('is true only for the Admin role, with no implicit permissions', async () => {
    const admin = person('role-admin')
    const manager = person('role-manager')
    await give(admin, 'admin')
    await give(manager, 'manager')
    assert.equal(await isInstanceAdmin(admin), true)
    assert.equal(await isInstanceAdmin(manager), false)
    assert.deepEqual(await instancePermissions(admin), [])
    assert.deepEqual((await listInstanceAdmins()).map((a) => a.sub), ['role-admin'])
    assert.equal(await userHasAnyGrant(admin), true)
    assert.equal(await userHasAnyGrant(manager), false)
  })

  it('bootstrap assigns the Admin role to an allowlisted identity and no one else', async () => {
    const boot = person('boot-admin')
    assert.equal(await maybeBootstrapInstanceAdmin(boot), true)
    assert.equal(await getUserRole(boot), 'admin')
    assert.equal(await maybeBootstrapInstanceAdmin(person('stranger')), false)
    assert.equal(await getUserRole(person('stranger')), null)
  })
})
