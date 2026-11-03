import './db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ensurePrincipal } from './authentication/session/session.js'
import { authorizeApiRequest } from './authz.js'
import { createNamespaceAuthz } from './authzNamespaceStore.js'
import { assignRole } from './rbacStore.js'
import type { InstanceRole } from './rbacRoles.js'

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

describe('RBAC S27 Non-auditor repo ACL', () => {
  for (const role of ['external', 'user', 'manager', 'admin'] as const satisfies readonly InstanceRole[]) {
    it(`denies ${role} private-repo read without collaborator membership`, async () => {
      const u = person(`acl-${role}`)
      await ensurePrincipal(u)
      assert.equal(
        (await assignRole({
          actor: null,
          target: u,
          role,
          reason: 'boot',
          bootstrap: true,
        })).ok,
        true,
      )
      const ns = `acl-ns-${role}`
      assert.equal((await createNamespaceAuthz(seed, ns, 'none', true)).ok, true)

      const d = await authorizeApiRequest({
        user: u,
        via: 'session',
        method: 'GET',
        pathname: `/api/repos/${ns}/secret`,
      })
      assert.equal(d.allow, false)
      assert.equal(d.siteAdminBypass, undefined)
    })
  }

  it('denies Auditor write on a private repo without collaborator membership', async () => {
    const auditor = person('acl-auditor-write')
    await ensurePrincipal(auditor)
    assert.equal(
      (await assignRole({
        actor: null,
        target: auditor,
        role: 'auditor',
        reason: 'boot',
        bootstrap: true,
      })).ok,
      true,
    )
    assert.equal((await createNamespaceAuthz(seed, 'acl-ns-aud-w', 'none', true)).ok, true)

    const d = await authorizeApiRequest({
      user: auditor,
      via: 'session',
      method: 'PUT',
      pathname: '/api/repos/acl-ns-aud-w/secret/file/main/a.txt',
    })
    assert.equal(d.allow, false)
  })
})
