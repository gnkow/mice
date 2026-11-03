import './db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ensurePrincipal } from './authentication/session/session.js'
import { isPendingUser } from './authz.js'
import { createNamespaceAuthz } from './authzNamespaceStore.js'
import { setNamespaceMember } from './authzMembershipStore.js'
import { assignRole } from './rbacStore.js'

process.env.AUTHZ_BOOTSTRAP_ADMINS = 'admin-pending@mice.local'
process.env.AUTHZ_REQUIRE_TRAINING = 'false'

const admin = {
  sub: 'admin-pending',
  iss: 'test',
  email: 'admin-pending@mice.local',
  emailVerified: true as const,
  name: 'Admin',
}

const person = (sub: string) => ({
  sub,
  iss: 'https://idp.test',
  email: `${sub}@example.com`,
  emailVerified: true as const,
  name: sub,
})

const { preparePrincipal } = await import('./authz.js')
await preparePrincipal(admin)
await assignRole({ actor: null, target: admin, role: 'admin', reason: 'boot', bootstrap: true })

describe('RBAC S23 pending gate', () => {
  it('treats users with no formal role as pending even if they have namespace membership', async () => {
    const user = person('pending-ns-member')
    await ensurePrincipal(user)
    assert.equal((await createNamespaceAuthz(admin, 'pending-ns', 'none', true)).ok, true)
    assert.equal((await setNamespaceMember('pending-ns', user, 'member')).ok, true)
    assert.equal(await isPendingUser(user), true)
  })

  it('clears pending once a formal role is assigned, without requiring namespace membership', async () => {
    const user = person('pending-with-role')
    await ensurePrincipal(user)
    assert.equal(await isPendingUser(user), true)
    assert.equal(
      (
        await assignRole({
          actor: null,
          target: user,
          role: 'external',
          reason: 'boot',
          bootstrap: true,
        })
      ).ok,
      true,
    )
    assert.equal(await isPendingUser(user), false)
  })
})
