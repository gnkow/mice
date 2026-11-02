import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

process.env.SESSION_SECRET = 'test-session-secret-for-identity'
process.env.AUTHZ_BOOTSTRAP_ADMINS =
  'boss@example.com,https://idp-a.example/realms/mice|admin-sub,ghost@users.local'
const { maybeBootstrapInstanceAdmin, isInstanceAdmin } = await import('../../authzInstanceStore.js')
const { matchesIdentityEntry, isScopedCredential } = await import('./principal.js')

describe('isScopedCredential', () => {
  it('is true only for a PAT carrying scopes', () => {
    assert.equal(isScopedCredential({}), false)
    assert.equal(isScopedCredential({ patScopes: [] }), false)
    assert.equal(
      isScopedCredential({ patScopes: [{ namespace: 'a', maxRole: 'read' }] }),
      true,
    )
  })
})

const { getDb } = await import('../../db/database.js')
const { instanceAdmins } = await import('../../db/schema.js')
const reset = async () => { await getDb().delete(instanceAdmins) }

describe('bootstrap identity matching', () => {
  it('matches iss+sub and distinguishes issuers sharing a sub', () => {
    const a = { sub: 'admin-sub', iss: 'https://idp-a.example/realms/mice', email: 'x@y.io' }
    const b = { ...a, iss: 'https://idp-b.example/realms/mice' }
    assert.equal(matchesIdentityEntry('https://idp-a.example/realms/mice|admin-sub', a), true)
    assert.equal(matchesIdentityEntry('https://idp-a.example/realms/mice|admin-sub', b), false)
  })

  it('grants nothing for an unverified email', async () => {
    const u = { sub: 's', iss: 'i', email: 'boss@example.com' }
    assert.equal(matchesIdentityEntry('boss@example.com', u), false)
    await reset()
    assert.equal(await maybeBootstrapInstanceAdmin({ ...u, name: 'B' }), false)
  })

  it('still bootstraps with a verified email', async () => {
    const u = { sub: 's1', iss: 'i', email: 'Boss@Example.com', emailVerified: true, name: 'B' }
    await reset()
    assert.equal(await maybeBootstrapInstanceAdmin(u), true)
    assert.equal(await isInstanceAdmin(u), true)
  })

  it('grants every allowlisted identity after an admin already exists', async () => {
    await reset()
    const first = { sub: 's1', iss: 'i', email: 'boss@example.com', emailVerified: true, name: 'B' }
    assert.equal(await maybeBootstrapInstanceAdmin(first), true)
    const second = {
      sub: 'admin-sub',
      iss: 'https://idp-a.example/realms/mice',
      email: 'other@example.com',
      emailVerified: true,
      name: 'A',
    }
    assert.equal(await maybeBootstrapInstanceAdmin(second), true)
    assert.equal(await isInstanceAdmin(second), true)
    const outsider = { sub: 'x', iss: 'i', email: 'x@example.com', emailVerified: true, name: 'X' }
    assert.equal(await maybeBootstrapInstanceAdmin(outsider), false)
    assert.equal(await isInstanceAdmin(outsider), false)
  })

  it('never matches a bare sub or the @users.local fallback', () => {
    assert.equal(matchesIdentityEntry('admin-sub', { sub: 'admin-sub', iss: 'i', email: 'a@b.io' }), false)
    const ghost = { sub: 'ghost', iss: 'i', email: 'ghost@users.local', emailVerified: true }
    assert.equal(matchesIdentityEntry('ghost@users.local', ghost), false)
  })
})
