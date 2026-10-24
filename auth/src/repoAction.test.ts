import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { createMemoryJsonBackend, useJsonBackend } from './jsonStore.js'

// In-memory persistence adapter: no data dir, nothing touches disk.
const memory = createMemoryJsonBackend()
let writes = 0
const restoreBackend = useJsonBackend({
  read: (path) => memory.read(path),
  write: (path, text) => {
    writes++
    memory.write(path, text)
  },
})
process.env.AUTH_DATA_DIR = '/mice-memory-data'
process.env.AUTHZ_ENFORCE = 'true'
process.env.AUTHZ_DEV_GRANT_ALL = 'false'
process.env.AUTHZ_BOOTSTRAP_ADMINS = 'admin@mice.local'
process.env.AUTHZ_REQUIRE_TRAINING = 'false'
process.env.AUTHZ_GROUP_BOOTSTRAP = JSON.stringify({
  'ra-fresh@example.com': { instancePermissions: ['view_audit'] },
})
process.env.SESSION_SECRET = 'test-secret'
process.env.OXEN_UPSTREAM = 'http://127.0.0.1:3001'

const { authorizeRepoAction, preparePrincipal } = await import('./authz.js')
const { setRepoCollaborator } = await import('./authzCollaboratorStore.js')
const { createNamespaceAuthz } = await import('./authzNamespaceStore.js')

after(() => restoreBackend())

const person = (sub: string) => ({
  sub,
  iss: 'test',
  email: `${sub}@example.com`,
  name: sub,
})
const admin = { sub: 'admin', iss: 'test', email: 'admin@mice.local', name: 'Admin' }
preparePrincipal(admin)

const ns = 'ra-ns'
const reader = person('ra-reader')
const writer = person('ra-writer')
const outsider = person('ra-outsider')
createNamespaceAuthz(admin, ns, 'none', true)
setRepoCollaborator(ns, 'r', reader, 'read')
setRepoCollaborator(ns, 'r', writer, 'write')
for (const u of [reader, writer, outsider]) preparePrincipal(u)

describe('authorizeRepoAction', () => {
  const readActions = ['job.read', 'workspace.read'] as const
  const writeActions = ['job.submit', 'job.cancel', 'job.complete', 'workspace.write'] as const

  for (const action of readActions) {
    it(`${action}: Read allows, outsider denied`, () => {
      assert.equal(authorizeRepoAction(reader, ns, 'r', action).allow, true)
      assert.equal(authorizeRepoAction(outsider, ns, 'r', action).allow, false)
    })
  }
  for (const action of writeActions) {
    it(`${action}: Write allows, Read denied`, () => {
      assert.equal(authorizeRepoAction(writer, ns, 'r', action).allow, true)
      const denied = authorizeRepoAction(reader, ns, 'r', action)
      assert.equal(denied.allow, false)
      assert.ok(denied.reason)
    })
  }

  it('keeps the denial reasons callers surface', () => {
    assert.equal(
      authorizeRepoAction(reader, ns, 'r', 'job.submit').reason,
      'job.submit requires repository write or job_submit',
    )
    assert.equal(
      authorizeRepoAction(outsider, ns, 'r', 'workspace.write').reason,
      'Requires repository write',
    )
  })

  it('is read-only: a decision does not write state', () => {
    const before = writes
    authorizeRepoAction({ ...person('ra-fresh'), emailVerified: true }, ns, 'r', 'job.read')
    assert.equal(writes, before)
  })
})
