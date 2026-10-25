import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { readText, removeText, writeText } from './jsonStore.js'

const dataDir = mkdtempSync(join(tmpdir(), 'mice-identity-'))
process.env.AUTH_DATA_DIR = dataDir
process.env.SESSION_SECRET = 'test-session-secret-for-identity'
process.env.AUTHZ_BOOTSTRAP_ADMINS =
  'boss@example.com,https://idp-a.example/realms/mice|admin-sub,ghost@users.local'
process.env.AUTHZ_GROUP_BOOTSTRAP = '{}'

const { maybeBootstrapInstanceAdmin, isInstanceAdmin } = await import('./authzInstanceStore.js')
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
const { migrateIdentityKeys } = await import('./identityMigration.js')

const reset = () => writeText(join(dataDir, 'instance-admins.json'), '')

describe('bootstrap identity matching', () => {
  it('matches iss+sub and distinguishes issuers sharing a sub', () => {
    const a = { sub: 'admin-sub', iss: 'https://idp-a.example/realms/mice', email: 'x@y.io' }
    const b = { ...a, iss: 'https://idp-b.example/realms/mice' }
    assert.equal(matchesIdentityEntry('https://idp-a.example/realms/mice|admin-sub', a), true)
    assert.equal(matchesIdentityEntry('https://idp-a.example/realms/mice|admin-sub', b), false)
  })

  it('grants nothing for an unverified email', () => {
    const u = { sub: 's', iss: 'i', email: 'boss@example.com' }
    assert.equal(matchesIdentityEntry('boss@example.com', u), false)
    reset()
    assert.equal(maybeBootstrapInstanceAdmin({ ...u, name: 'B' }), false)
  })

  it('still bootstraps with a verified email', () => {
    const u = { sub: 's1', iss: 'i', email: 'Boss@Example.com', emailVerified: true, name: 'B' }
    reset()
    assert.equal(maybeBootstrapInstanceAdmin(u), true)
    assert.equal(isInstanceAdmin(u), true)
  })

  it('never matches a bare sub or the @users.local fallback', () => {
    assert.equal(matchesIdentityEntry('admin-sub', { sub: 'admin-sub', iss: 'i', email: 'a@b.io' }), false)
    const ghost = { sub: 'ghost', iss: 'i', email: 'ghost@users.local', emailVerified: true }
    assert.equal(matchesIdentityEntry('ghost@users.local', ghost), false)
  })
})

describe('identity key migration', () => {
  const issuer = 'https://idp-a.example/realms/mice'
  const q = (s: string) => `${issuer}\0${s}`

  it('rewrites bare keys once and preserves access', () => {
    writeText(
      join(dataDir, 'instance-admins.json'),
      JSON.stringify({ version: 1, enforce: true, admins: ['old-admin', q('new-admin')], permissions: { 'old-admin': ['view_audit'] } }),
    )
    writeText(
      join(dataDir, 'namespace-members.json'),
      JSON.stringify({ version: 2, members: { team: { 'old-member': 'owner' } } }),
    )
    assert.equal(migrateIdentityKeys(issuer), 3)
    const admins = JSON.parse(readText(join(dataDir, 'instance-admins.json'))!)
    assert.deepEqual(admins.admins, [q('old-admin'), q('new-admin')])
    assert.deepEqual(admins.permissions, { [q('old-admin')]: ['view_audit'] })
    const members = JSON.parse(readText(join(dataDir, 'namespace-members.json'))!)
    assert.deepEqual(members.members.team, { [q('old-member')]: 'owner' })

    const snapshot = readText(join(dataDir, 'instance-admins.json'))!
    assert.equal(migrateIdentityKeys(issuer), 0)
    assert.equal(readText(join(dataDir, 'instance-admins.json'))!, snapshot)
  })
})
