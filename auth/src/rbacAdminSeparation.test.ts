import './db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ensurePrincipal } from './authentication/session/session.js'
import { authorizeApiRequest, authorizeAuditQuery, decideInstanceAction } from './authz.js'
import { createNamespaceAuthz } from './authzNamespaceStore.js'
import { assignRole } from './rbacStore.js'

process.env.AUTHZ_BOOTSTRAP_ADMINS = 'seed-admin@mice.local'
process.env.AUTHZ_REQUIRE_TRAINING = 'false'

const seed = {
  sub: 'seed-admin',
  iss: 'test',
  email: 'seed-admin@mice.local',
  emailVerified: true as const,
  name: 'Seed',
}

const { preparePrincipal } = await import('./authz.js')
await preparePrincipal(seed)
await assignRole({ actor: null, target: seed, role: 'admin', reason: 'boot', bootstrap: true })

const person = (sub: string) => ({
  sub,
  iss: 'https://idp.test',
  email: `${sub}@example.com`,
  emailVerified: true as const,
  name: sub,
})

describe('RBAC S25 Admin separation of duties', () => {
  it('denies Admin role audit and private repo reads', async () => {
    const admin = person('sod-admin')
    await ensurePrincipal(admin)
    assert.equal(
      (await assignRole({ actor: null, target: admin, role: 'admin', reason: 'boot', bootstrap: true })).ok,
      true,
    )
    assert.equal((await decideInstanceAction(admin, 'audit.view')).allow, false)
    assert.equal((await authorizeAuditQuery(admin, undefined)).allow, false)

    assert.equal((await createNamespaceAuthz(seed, 'sod-ns', 'none', true)).ok, true)
    const d = await authorizeApiRequest({
      user: admin,
      via: 'session',
      method: 'GET',
      pathname: '/api/repos/sod-ns/secret',
    })
    assert.equal(d.allow, false)
    assert.equal(d.aclBypass, undefined)
  })

  it('does not let boolean instance-admin bypass repository ACLs', async () => {
    const admin2 = person('sod-bool-admin')
    await ensurePrincipal(admin2)
    await assignRole({ actor: null, target: admin2, role: 'admin', reason: 'boot', bootstrap: true })
    assert.equal((await createNamespaceAuthz(seed, 'sod-ns2', 'none', true)).ok, true)
    const d = await authorizeApiRequest({
      user: admin2,
      via: 'session',
      method: 'GET',
      pathname: '/api/repos/sod-ns2/secret',
    })
    assert.equal(d.allow, false)
  })
})
