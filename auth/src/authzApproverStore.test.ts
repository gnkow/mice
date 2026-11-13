import './db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { isolatedAuth } from './testSupport.js'

const t = isolatedAuth({ AUTHZ_BOOTSTRAP_ADMINS: 'root@x.io' })
after(() => t.restore())

const { preparePrincipal } = await import('./authz.js')
const { createNamespaceAuthz } = await import('./authzNamespaceStore.js')
const { ensureRepository } = await import('./repositoryStore.js')
const {
  decideIsApprover,
  grantApprover,
  revokeApprover,
} = await import('./authzApproverStore.js')
const authz = await import('./authz.js')

const root = { ...t.person('root'), email: 'root@x.io', emailVerified: true as const }
const owner = t.person('owner')
const bob = t.person('bob')
const carol = t.person('carol')
await preparePrincipal(root)
await preparePrincipal(owner)
await t.grantRole(owner, 'manager')
await preparePrincipal(bob)
await preparePrincipal(carol)

assert.equal((await createNamespaceAuthz(owner, 'acme', 'none')).ok, true)
assert.ok(await ensureRepository('acme', 'data'))

describe('authzApproverStore decideIsApprover', () => {
  it('denies until an explicit repository grant exists', async () => {
    assert.equal((await decideIsApprover(bob, 'acme', 'data')).allow, false)
    assert.equal((await decideIsApprover(bob, 'acme', 'data')).reason, 'Approver role required')
    assert.equal((await decideIsApprover(bob, 'acme', 'data')).status, 403)

    assert.equal(await grantApprover({ ns: 'acme', repo: 'data' }, bob), true)
    const allowed = await decideIsApprover(bob, 'acme', 'data')
    assert.equal(allowed.allow, true)
    assert.equal(allowed.status, 200)
    assert.equal((await decideIsApprover(bob, 'acme', 'other')).allow, false)

    assert.equal(await revokeApprover({ ns: 'acme', repo: 'data' }, bob), true)
    assert.equal((await decideIsApprover(bob, 'acme', 'data')).allow, false)
  })

  it('namespace-scope grant covers every repository in that namespace', async () => {
    assert.equal(await grantApprover({ ns: 'acme' }, carol), true)
    assert.equal((await decideIsApprover(carol, 'acme', 'data')).allow, true)
    assert.equal((await decideIsApprover(carol, 'acme', 'other')).allow, true)
    assert.equal(await revokeApprover({ ns: 'acme' }, carol), true)
    assert.equal((await decideIsApprover(carol, 'acme', 'data')).allow, false)
  })

  it('authz re-exports the same decideIsApprover seam', async () => {
    assert.equal(authz.decideIsApprover, decideIsApprover)
    assert.equal(await grantApprover({ ns: 'acme', repo: 'data' }, bob), true)
    assert.equal((await authz.decideIsApprover(bob, 'acme', 'data')).allow, true)
    assert.equal(await revokeApprover({ ns: 'acme', repo: 'data' }, bob), true)
  })
})
