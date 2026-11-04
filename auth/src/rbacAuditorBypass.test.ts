import './db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ensurePrincipal } from './authentication/session/session.js'
import { authorizeApiRequest } from './authz.js'
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

describe('RBAC S26 Auditor ACL bypass', () => {
  it('lets Auditor read a private repo without collaborator membership', async () => {
    const auditor = {
      ...person('auditor-bypass'),
      idToken: ['e30', Buffer.from(JSON.stringify({ acr: 'mfa', amr: ['pwd', 'otp'] })).toString('base64url'), 's'].join('.'),
    }
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
    assert.equal((await createNamespaceAuthz(seed, 'aud-bypass-ns', 'none', true)).ok, true)

    const d = await authorizeApiRequest({
      user: auditor,
      via: 'session',
      method: 'GET',
      pathname: '/api/repos/aud-bypass-ns/secret',
    })
    assert.equal(d.allow, true)
    assert.equal(d.aclBypass, true)
  })
})
