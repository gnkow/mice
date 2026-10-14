import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

const dataDir = mkdtempSync(join(tmpdir(), 'boxen-directory-'))

process.env.AUTH_DATA_DIR = dataDir
process.env.AUTHZ_ENFORCE = 'true'
process.env.AUTH_DEV_MODE = 'false'
process.env.AUTHZ_DEV_GRANT_ALL = 'false'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'admin@boxen.local'
process.env.AUTHZ_REQUIRE_TRAINING = 'false'
process.env.SESSION_SECRET = 'test-secret'
process.env.OXEN_UPSTREAM = 'http://127.0.0.1:3001'
process.env.DIRECTORY_PROVIDER = 'none'
process.env.KEYCLOAK_ADMIN_URL = ''
process.env.OIDC_CLIENT_ID = 'boxen-auth'
process.env.OIDC_CLIENT_SECRET = 'boxen-auth-secret'
process.env.OIDC_ISSUER_PUBLIC = 'http://localhost:8180/realms/boxen'

const {
  canSearchDirectory,
  searchDirectory,
  searchStoreDirectory,
  setDirectoryFetchForTests,
  keycloakDirectoryConfigured,
} = await import('./directory.js')
const {
  createNamespaceAuthz,
  setNamespaceMember,
  setNamespaceGroupMember,
  setRepoCollaborator,
  writeInstancePermissions,
} = await import('./authzStore.js')
const { preparePrincipal } = await import('./authz.js')

const admin = {
  sub: 'admin-sub',
  iss: 'boxen-dev',
  email: 'admin@boxen.local',
  name: 'Admin',
}

const pending = {
  sub: 'pending-sub',
  iss: 'boxen-dev',
  email: 'pending@boxen.local',
  name: 'Pending',
}

describe('directory search', () => {
  before(() => {
    preparePrincipal(admin)
    const created = createNamespaceAuthz(admin, 'dir-ns', 'none', true)
    assert.equal(created.ok, true)
    setNamespaceMember(
      'dir-ns',
      { sub: 'alice-sub', iss: 'boxen-dev' },
      'member',
    )
    setNamespaceGroupMember('dir-ns', 'engineering', 'member')
    setRepoCollaborator(
      'dir-ns',
      'r1',
      { sub: 'bob-collab', iss: 'boxen-dev' },
      'write',
    )
  })

  after(() => {
    setDirectoryFetchForTests(null)
    rmSync(dataDir, { recursive: true, force: true })
  })

  it('store search finds known users and groups', () => {
    const users = searchStoreDirectory('alice', 'user', 10)
    assert.ok(users.some((u) => u.kind === 'user' && u.sub === 'alice-sub'))
    const groups = searchStoreDirectory('engin', 'group', 10)
    assert.ok(groups.some((g) => g.kind === 'group' && g.group === 'engineering'))
    const collab = searchStoreDirectory('bob-collab', 'user', 10)
    assert.ok(collab.some((u) => u.kind === 'user' && u.sub === 'bob-collab'))
  })

  it('empty query returns no results', async () => {
    const res = await searchDirectory({ q: '' })
    assert.equal(res.results.length, 0)
    assert.equal(res.source, 'none')
  })

  it('canSearchDirectory allows admins and manage_members; denies pending', () => {
    preparePrincipal(admin)
    assert.equal(canSearchDirectory(admin), true)

    preparePrincipal(pending)
    assert.equal(canSearchDirectory(pending), false)

    const member = {
      sub: 'alice-sub',
      iss: 'boxen-dev',
      email: 'alice@boxen.local',
      name: 'Alice',
    }
    preparePrincipal(member)
    // member without manage_members / owner → deny
    assert.equal(canSearchDirectory(member), false)

    writeInstancePermissions(pending, ['create_namespace'])
    preparePrincipal(pending)
    assert.equal(canSearchDirectory(pending), true)
  })

  it('Keycloak mock merges with store', async () => {
    process.env.DIRECTORY_PROVIDER = 'keycloak'
    process.env.KEYCLOAK_ADMIN_URL = 'http://keycloak.test'
    // Re-read env module is cached — use setDirectoryFetch and temporarily
    // monkey-patch via dynamic re-import is hard. Call search with fetch mock
    // only works if keycloakDirectoryConfigured() is true.
    // env was loaded with DIRECTORY_PROVIDER=none; force via mutating is not exported.
    // Instead verify configured helper against current env (false) and test fetch path
    // by reloading — skip if env frozen.
    assert.equal(keycloakDirectoryConfigured(), false)

    // Direct mock path: temporarily set env fields on imported env object
    const { env } = await import('./env.js')
    const prevProvider = env.directoryProvider
    const prevUrl = env.keycloakAdminUrl
    ;(env as { directoryProvider: string }).directoryProvider = 'keycloak'
    ;(env as { keycloakAdminUrl: string }).keycloakAdminUrl =
      'http://keycloak.test'
    assert.equal(keycloakDirectoryConfigured(), true)

    setDirectoryFetchForTests(async (input) => {
      const url = String(input)
      if (url.includes('/token')) {
        return new Response(
          JSON.stringify({ access_token: 'tok', expires_in: 60 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url.includes('/users')) {
        return new Response(
          JSON.stringify([
            {
              id: 'kc-uuid-1',
              username: 'boxen',
              email: 'boxen@example.com',
              firstName: 'Boxen',
              lastName: 'User',
              enabled: true,
            },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('not found', { status: 404 })
    })

    const res = await searchDirectory({ q: 'boxen', kind: 'user', limit: 10 })
    assert.ok(res.results.some((r) => r.kind === 'user' && r.sub === 'kc-uuid-1'))
    assert.ok(
      res.source === 'keycloak' || res.source === 'mixed' || res.source === 'store',
    )
    assert.equal(res.providerConfigured, true)

    setDirectoryFetchForTests(null)
    ;(env as { directoryProvider: string }).directoryProvider = prevProvider
    ;(env as { keycloakAdminUrl: string }).keycloakAdminUrl = prevUrl
  })
})
