import './db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { isolatedAuth } from './testSupport.js'

const t = isolatedAuth()
after(() => t.restore())

const authz = await import('./authz.js')
const { createNamespaceAuthz } = await import('./authzNamespaceStore.js')
const { setNamespaceMember } = await import('./authzMembershipStore.js')
const { createCustomNamespaceRole } = await import('./customRoles.js')
const { decideInstanceAction, decideNamespaceAction, decideAccessReview, preparePrincipal } = authz

const admin = t.admin
await preparePrincipal(admin)
const scoped = <T extends object>(u: T) => ({ ...u, patScopes: [{ namespace: 'x', maxRole: 'read' as const }] })

const ALLOW = { allow: true, status: 200, reason: 'ok' }
const deny = (reason: string) => ({ allow: false, status: 403, reason })

type InstanceCase = {
  action: Parameters<typeof decideInstanceAction>[1]
  /** Formal role that holds the mapped permission (S24). */
  grantRole: 'user' | 'manager' | 'admin' | 'auditor'
  reason: string
  /** Admin role is denied (S25 separation) even though they are bootstrap admin. */
  adminDenied?: boolean
  /** Scoped credentials are rejected even with the permission. */
  unscopedOnly?: boolean
}

const INSTANCE_CASES: InstanceCase[] = [
  { action: 'tokens.manage', grantRole: 'user', reason: 'Missing permission tokens:create' },
  { action: 'cli.device.approve', grantRole: 'manager', reason: 'Missing permission cli_device:approve', adminDenied: true },
  { action: 'audit.view', grantRole: 'manager', reason: 'Missing permission audit:read', adminDenied: true },
  { action: 'lineage.view', grantRole: 'manager', reason: 'Missing permission lineage:read', adminDenied: true },
  { action: 'store.admin', grantRole: 'admin', reason: 'Missing permission store:gc', unscopedOnly: true },
  { action: 'instance.admin', grantRole: 'admin', reason: 'Missing permission instance:admins:add' },
  { action: 'directory.sync', grantRole: 'admin', reason: 'Missing permission instance:settings:update' },
  { action: 'namespace.create', grantRole: 'manager', reason: 'Missing permission namespace:create', adminDenied: true },
  { action: 'access.review.all', grantRole: 'manager', reason: 'Missing permission access_request:review' },
  { action: 'session.admin', grantRole: 'manager', reason: 'Missing permission session:delete', adminDenied: true },
  { action: 'session.create', grantRole: 'manager', reason: 'Missing permission session:create', adminDenied: true },
  { action: 'session.connect', grantRole: 'user', reason: 'Missing permission session:connect', adminDenied: true },
]

describe('decideInstanceAction matrix', () => {
  for (const c of INSTANCE_CASES) {
    describe(c.action, async () => {
      const holder = t.person(`holder-${c.action}`)
      const none = t.person(`none-${c.action}`)
      await t.grantRole(holder, c.grantRole)
      await preparePrincipal(none)

      it('bootstrap Admin role', async () => {
        const d = await decideInstanceAction(admin, c.action)
        if (c.adminDenied) assert.deepEqual(d, deny(c.reason))
        else assert.deepEqual(d, ALLOW)
      })

      it('granted role allows', async () => {
        assert.deepEqual(await decideInstanceAction(holder, c.action), ALLOW)
      })

      it('scoped credential', async () => {
        if (c.unscopedOnly) {
          assert.deepEqual(await decideInstanceAction(scoped(holder) as never, c.action), deny(c.reason))
        } else {
          assert.deepEqual(await decideInstanceAction(scoped(holder) as never, c.action), ALLOW)
        }
      })

      it('none denies with the recorded reason', async () => {
        assert.deepEqual(await decideInstanceAction(none, c.action), deny(c.reason))
      })
    })
  }
})

describe('decideNamespaceAction matrix', async () => {
  const owner = t.person('ns-owner')
  const member = t.person('ns-member')
  const reviewer = t.person('ns-reviewer')
  const none = t.person('ns-none')
  for (const u of [owner, member, reviewer, none]) await preparePrincipal(u)
  await createNamespaceAuthz(owner, 'ns1', 'read')
  await setNamespaceMember('ns1', member, 'member')
  const role = await createCustomNamespaceRole('ns1', { name: 'Reviewer', permissions: ['review_access_requests', 'manage_settings'] })
  assert.ok(role.ok)
  if (role.ok) await setNamespaceMember('ns1', reviewer, role.role.id)

  const FORBIDDEN = 'Forbidden'
  const CASES = [
    { action: 'namespace.view', named: member, ownerAllowed: true, reason: FORBIDDEN },
    { action: 'namespace.settings', named: reviewer, ownerAllowed: true, reason: FORBIDDEN },
    { action: 'namespace.settings.metadata', named: reviewer, ownerAllowed: true, reason: FORBIDDEN, unscopedOnly: true },
    { action: 'namespace.delete', named: null, ownerAllowed: true, reason: FORBIDDEN },
    { action: 'namespace.members.manage', named: null, ownerAllowed: true, reason: FORBIDDEN },
    { action: 'namespace.roles.manage', named: null, ownerAllowed: true, reason: FORBIDDEN },
    { action: 'namespace.access.review', named: reviewer, ownerAllowed: true, reason: 'Not allowed to approve into that namespace' },
  ] as const

  for (const c of CASES) {
    describe(c.action, () => {
      it('denies a non-member and allows the owner', async () => {
        assert.deepEqual(await decideNamespaceAction(none, 'ns1', c.action), deny(c.reason))
        assert.deepEqual(await decideNamespaceAction(owner, 'ns1', c.action), ALLOW)
      })

      it('denies an instance admin without membership (separation of duties)', async () => {
        assert.deepEqual(await decideNamespaceAction(admin, 'ns1', c.action), deny(c.reason))
      })

      if (c.named) {
        it('named capability or membership allows', async () => {
          assert.deepEqual(await decideNamespaceAction(c.named, 'ns1', c.action), ALLOW)
        })
      }

      it('scoped credential', async () => {
        const scopedReviewer = scoped(reviewer) as never
        const expected = 'unscopedOnly' in c ? deny(c.reason) : c.named ? ALLOW : deny(c.reason)
        assert.deepEqual(await decideNamespaceAction(scopedReviewer, 'ns1', c.action), expected)
      })

      it('none denies with the recorded reason', async () => {
        assert.deepEqual(await decideNamespaceAction(none, 'ns1', c.action), deny(c.reason))
        assert.deepEqual(await decideNamespaceAction(member, 'ns1', c.action), c.named === member ? ALLOW : deny(c.reason))
      })
    })
  }
})

describe('composite decisions', async () => {
  const none = t.person('comp-none')
  const creator = t.person('comp-creator')
  const reviewer = t.person('comp-reviewer')
  for (const u of [none, creator, reviewer]) await preparePrincipal(u)

  it('access review: Admin/Manager role or a review capability; others deny', async () => {
    await createNamespaceAuthz(creator, 'ns2', 'none')
    const role = await createCustomNamespaceRole('ns2', { name: 'R', permissions: ['review_access_requests'] })
    if (role.ok) await setNamespaceMember('ns2', reviewer, role.role.id)
    await t.grantRole(creator, 'manager')
    assert.deepEqual(await decideAccessReview(admin), ALLOW)
    assert.deepEqual(await decideAccessReview(creator), ALLOW)
    assert.deepEqual(await decideAccessReview(reviewer), ALLOW)
    assert.deepEqual(await decideAccessReview(none), deny('Forbidden'))
  })

  it('service principal management API is gone', () => {
    assert.equal('decideServicePrincipalManage' in authz, false)
  })

  it('repo collaborator management carries status and reason', async () => {
    assert.deepEqual(await authz.decideManageRepoCollaborators(admin, 'ns2', 'r'), deny('Forbidden'))
    assert.deepEqual(await authz.decideManageRepoCollaborators(none, 'ns2', 'r'), deny('Forbidden'))
  })

  it('scoped-credential rule lives in one helper', async () => {
    assert.equal(await authz.isUnscopedInstanceAdmin(admin), true)
    assert.equal(await authz.isUnscopedInstanceAdmin(scoped(admin) as never), false)
    assert.equal(await authz.isUnscopedInstanceAdmin(none), false)
  })
})
