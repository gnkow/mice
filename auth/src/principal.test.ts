import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

const dataDir = mkdtempSync(join(tmpdir(), 'mice-identity-'))
process.env.AUTH_DATA_DIR = dataDir
process.env.SESSION_SECRET = 'test-session-secret-for-identity'
process.env.AUTHZ_BOOTSTRAP_ADMINS =
  'boss@example.com,https://idp-a.example/realms/mice|admin-sub,ghost@users.local'
process.env.AUTHZ_GROUP_BOOTSTRAP = '{}'

const { maybeBootstrapInstanceAdmin, isInstanceAdmin } = await import('./authzStore.js')
const { matchesIdentityEntry } = await import('./principal.js')
const { migrateIdentityKeys } = await import('./identityMigration.js')

const reset = () => writeFileSync(join(dataDir, 'instance-admins.json'), '')

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
    writeFileSync(
      join(dataDir, 'instance-admins.json'),
      JSON.stringify({ version: 1, enforce: true, admins: ['old-admin', q('new-admin')], permissions: { 'old-admin': ['view_audit'] } }),
    )
    writeFileSync(
      join(dataDir, 'namespace-members.json'),
      JSON.stringify({ version: 2, members: { team: { 'old-member': 'owner' } } }),
    )
    assert.equal(migrateIdentityKeys(issuer), 3)
    const admins = JSON.parse(readFileSync(join(dataDir, 'instance-admins.json'), 'utf8'))
    assert.deepEqual(admins.admins, [q('old-admin'), q('new-admin')])
    assert.deepEqual(admins.permissions, { [q('old-admin')]: ['view_audit'] })
    const members = JSON.parse(readFileSync(join(dataDir, 'namespace-members.json'), 'utf8'))
    assert.deepEqual(members.members.team, { [q('old-member')]: 'owner' })

    const snapshot = readFileSync(join(dataDir, 'instance-admins.json'), 'utf8')
    assert.equal(migrateIdentityKeys(issuer), 0)
    assert.equal(readFileSync(join(dataDir, 'instance-admins.json'), 'utf8'), snapshot)
  })
})
