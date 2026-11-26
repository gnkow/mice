import './db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { isolatedAuth } from '../src/packages/shared/lib/testSupport.js'

const t = isolatedAuth({ AUTHZ_BOOTSTRAP_ADMINS: 'root@x.io' })
after(() => t.restore())

const { preparePrincipal } = await import('../src/packages/authz/lib/authz.js')
const { createNamespaceAuthz } = await import('../src/packages/authz/lib/authzNamespaceStore.js')
const { ensureRepository } = await import('../src/packages/authz/lib/repositoryStore.js')
const {
  decideIsApprover,
  grantApprover,
  mutateApproverSeat,
  parseApproverTargetFromBody,
  revokeApprover,
} = await import('../src/packages/authz/lib/authzApproverStore.js')
const authz = await import('../src/packages/authz/lib/authz.js')

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

    assert.deepEqual(await grantApprover({ ns: 'acme', repo: 'data' }, { kind: 'user', ...bob }), {
      ok: true,
    })
    const allowed = await decideIsApprover(bob, 'acme', 'data')
    assert.equal(allowed.allow, true)
    assert.equal(allowed.status, 200)
    assert.equal((await decideIsApprover(bob, 'acme', 'other')).allow, false)

    assert.equal(await revokeApprover({ ns: 'acme', repo: 'data' }, { kind: 'user', ...bob }), true)
    assert.equal((await decideIsApprover(bob, 'acme', 'data')).allow, false)
  })

  it('namespace-scope grant covers every repository in that namespace', async () => {
    assert.deepEqual(await grantApprover({ ns: 'acme' }, { kind: 'user', ...carol }), { ok: true })
    assert.equal((await decideIsApprover(carol, 'acme', 'data')).allow, true)
    assert.equal((await decideIsApprover(carol, 'acme', 'other')).allow, true)
    assert.equal(await revokeApprover({ ns: 'acme' }, { kind: 'user', ...carol }), true)
    assert.equal((await decideIsApprover(carol, 'acme', 'data')).allow, false)
  })

  it('group seat grants approver to members of that IdP group', async () => {
    const groupId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    const groupKey = `test|${groupId}`
    assert.deepEqual(
      await grantApprover(
        { ns: 'acme', repo: 'data' },
        { kind: 'group', group: groupKey, name: 'QA' },
      ),
      { ok: true },
    )
    assert.equal((await decideIsApprover(bob, 'acme', 'data')).allow, false)
    assert.equal(
      (await decideIsApprover({ ...bob, groups: [groupKey] }, 'acme', 'data')).allow,
      true,
    )
    assert.equal(
      await revokeApprover({ ns: 'acme', repo: 'data' }, { kind: 'group', group: groupKey }),
      true,
    )
    assert.equal(
      (await decideIsApprover({ ...bob, groups: [groupKey] }, 'acme', 'data')).allow,
      false,
    )
  })

  it('authz re-exports the same decideIsApprover seam', async () => {
    assert.equal(authz.decideIsApprover, decideIsApprover)
    assert.deepEqual(await grantApprover({ ns: 'acme', repo: 'data' }, { kind: 'user', ...bob }), {
      ok: true,
    })
    assert.equal((await authz.decideIsApprover(bob, 'acme', 'data')).allow, true)
    assert.equal(await revokeApprover({ ns: 'acme', repo: 'data' }, { kind: 'user', ...bob }), true)
  })
})

describe('parseApproverTargetFromBody + mutateApproverSeat', () => {
  it('rejects incomplete bodies and accepts user or group targets', () => {
    assert.deepEqual(parseApproverTargetFromBody({}), { ok: false, error: 'sub and iss required' })
    assert.deepEqual(parseApproverTargetFromBody({ kind: 'group' }), {
      ok: false,
      error: 'group required',
    })
    assert.deepEqual(parseApproverTargetFromBody({ sub: bob.sub, iss: bob.iss }), {
      ok: true,
      target: { kind: 'user', sub: bob.sub, iss: bob.iss },
    })
    assert.deepEqual(
      parseApproverTargetFromBody({
        kind: 'group',
        group: 'test|aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        name: 'QA',
      }),
      {
        ok: true,
        target: {
          kind: 'group',
          group: 'test|aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
          name: 'QA',
        },
      },
    )
  })

  it('grants and revokes through one mutate seam used by the HTTP adapters', async () => {
    const granted = await mutateApproverSeat({
      op: 'grant',
      scope: { ns: 'acme', repo: 'data' },
      body: { sub: bob.sub, iss: bob.iss },
    })
    assert.equal(granted.ok, true)
    if (granted.ok) {
      assert.ok(
        granted.approvers.some((a) => a.kind === 'user' && a.sub === bob.sub && a.iss === bob.iss),
      )
    }
    assert.equal((await decideIsApprover(bob, 'acme', 'data')).allow, true)

    const revoked = await mutateApproverSeat({
      op: 'revoke',
      scope: { ns: 'acme', repo: 'data' },
      body: { sub: bob.sub, iss: bob.iss },
    })
    assert.equal(revoked.ok, true)
    assert.equal((await decideIsApprover(bob, 'acme', 'data')).allow, false)
  })
})
