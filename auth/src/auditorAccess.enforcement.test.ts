import './db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { ensurePrincipal } from './authentication/session/session.js'
import { authorizeApiRequest } from './authz.js'
import { createNamespaceAuthz } from './authzNamespaceStore.js'
import { assignRole } from './rbacStore.js'

process.env.AUTHZ_BOOTSTRAP_ADMINS = 'seed-admin@mice.local'
process.env.AUTHZ_REQUIRE_TRAINING = 'false'

const seed = { sub: 'seed-admin', iss: 'test', email: 'seed-admin@mice.local', emailVerified: true as const, name: 'Seed' }
const manager = { sub: 'owner-mgr', iss: 'https://idp.test', email: 'owner-mgr@example.com', emailVerified: true as const, name: 'Owner' }
const { preparePrincipal } = await import('./authz.js')
await preparePrincipal(seed)
await assignRole({ actor: null, target: seed, role: 'admin', reason: 'boot', bootstrap: true })
await assignRole({ actor: null, target: manager, role: 'manager', reason: 'boot', bootstrap: true })
assert.equal((await createNamespaceAuthz(manager, 'aud-ns', 'none', true)).ok, true)

const person = (sub: string) => ({ sub, iss: 'https://idp.test', email: `${sub}@example.com`, emailVerified: true as const, name: sub })
const grantAuditor = async (sub: string, expiresAt: number) => {
  const u = person(sub)
  await ensurePrincipal(u)
  assert.equal((await assignRole({ actor: seed, target: u, role: 'auditor', reason: 'audit', expiresAt })).ok, true)
  return u
}
const jwt = (claims: Record<string, unknown>) =>
  ['e30', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'sig'].join('.')
const withMfa = <T extends object>(u: T) => ({ ...u, idToken: jwt({ acr: 'mfa', amr: ['pwd', 'otp'] }) })
const decide = (user: ReturnType<typeof person> & { idToken?: string }, method: string, pathname: string) =>
  authorizeApiRequest({ user, via: 'session', method, pathname })

describe('Auditor access enforcement (#13)', () => {
  it('reads across ACLs but is refused write, merge and delete routes', async () => {
    const auditor = withMfa(await grantAuditor('aud-rw', Date.now() + 60_000))
    assert.equal((await decide(auditor, 'GET', '/api/repos/aud-ns/data')).allow, true)
    for (const [method, path] of [
      ['PUT', '/api/repos/aud-ns/data/file/main/a.csv'],
      ['POST', '/api/repos/aud-ns/data/merge'],
      ['DELETE', '/api/repos/aud-ns/data/branches/main'],
      ['DELETE', '/api/repos/aud-ns/data'],
    ] as const) {
      assert.equal((await decide(auditor, method, path)).allow, false, `${method} ${path}`)
    }
  })

  it('is refused on the next request once the grant expires', async () => {
    const auditor = withMfa(await grantAuditor('aud-exp', Date.now() + 2_000))
    assert.equal((await decide(auditor, 'GET', '/api/repos/aud-ns/data')).allow, true)
    await sleep(2_300)
    assert.equal((await decide(auditor, 'GET', '/api/repos/aud-ns/data')).allow, false)
  })

  it('requires MFA evidence on the session for cross-ACL reads', async () => {
    const auditor = await grantAuditor('aud-mfa', Date.now() + 60_000)
    const pwdOnly = { ...auditor, idToken: jwt({ acr: 'password', amr: ['pwd'] }) }
    assert.equal((await decide(auditor, 'GET', '/api/repos/aud-ns/data')).allow, false)
    assert.equal((await decide(pwdOnly, 'GET', '/api/repos/aud-ns/data')).allow, false)
    assert.equal((await decide(withMfa(auditor), 'GET', '/api/repos/aud-ns/data')).allow, true)
  })
})
