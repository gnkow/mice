import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import './db/testSchema.js'

const dataDir = mkdtempSync(join(tmpdir(), 'mice-admin-sod-'))

process.env.AUTH_DATA_DIR = dataDir
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'admin@mice.local'
process.env.AUTHZ_REQUIRE_TRAINING = 'false'
process.env.SESSION_SECRET = 'test-secret'
process.env.OXEN_UPSTREAM = 'http://127.0.0.1:3001'

const { authorizeApiRequest, authorizeInstanceAction, authorizeLineageRebuild, canManageRepoCollaborators, preparePrincipal } = await import('./authz.js')
const { addInstanceAdmin } = await import('./authzInstanceStore.js')
const { createNamespaceAuthz, listNamespacesForUser } = await import('./authzNamespaceStore.js')
const { hasNamespaceCapability, setNamespaceMember } = await import('./authzMembershipStore.js')
const { assignRole } = await import('./rbacStore.js')

const admin = { sub: 'admin', iss: 'test', email: 'admin@mice.local', emailVerified: true, name: 'Admin' }
const manager = { sub: 'manager', iss: 'test', email: 'manager@example.com', name: 'Manager' }

before(async () => {
  await preparePrincipal(admin)
  await assignRole({ actor: null, target: admin, role: 'admin', reason: 'test', bootstrap: true })
  await preparePrincipal(manager)
  await assignRole({ actor: null, target: manager, role: 'manager', reason: 'test', bootstrap: true })
  assert.equal((await createNamespaceAuthz(manager, 'sod-ns', 'none', true)).ok, true)
})

after(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

await describe('instance admin separation of duties', async () => {
  await it('refuses namespace membership for an instance admin', async () => {
    const r = await setNamespaceMember('sod-ns', admin, 'owner')
    assert.deepEqual(r, {
      ok: false,
      error: 'Instance admins cannot be granted namespace membership (separation of duties)',
    })
  })

  for (const [label, method, pathname] of [
    ['reads repository data', 'GET', '/api/repos/sod-ns/repo/file/main/a.csv'],
    ['lists a namespace\'s repositories', 'GET', '/api/repos/sod-ns'],
    ['writes repository data', 'POST', '/api/repos/sod-ns/repo/branches'],
  ] as const) {
    await it(`denies an instance admin who ${label} without membership`, async () => {
      const d = await authorizeApiRequest({ user: admin, via: 'session', method, pathname })
      assert.equal(d.allow, false)
    })
  }

  await it('gives an instance admin no namespace capabilities', async () => {
    assert.equal(await hasNamespaceCapability('sod-ns', admin, 'manage_members'), false)
  })

  await it('does not let an instance admin manage repository collaborators', async () => {
    assert.equal(await canManageRepoCollaborators(admin, 'sod-ns', 'repo'), false)
  })

  await it('does not let an instance admin rebuild repository lineage', async () => {
    assert.equal((await authorizeLineageRebuild(admin, 'sod-ns', 'repo')).allow, false)
  })

  await it('hides namespaces from an instance admin who is not a member', async () => {
    assert.deepEqual(await listNamespacesForUser(admin), [])
    assert.deepEqual((await listNamespacesForUser(manager)).map((n) => n.name), ['sod-ns'])
  })

  await it('lets an admin manage instance administrators but not read audit or lineage data', async () => {
    assert.equal((await authorizeInstanceAction(admin, 'instance.admin')).allow, true)
    assert.equal((await authorizeInstanceAction(admin, 'audit.view')).allow, false)
    assert.equal((await authorizeInstanceAction(admin, 'lineage.view')).allow, false)
  })
})
