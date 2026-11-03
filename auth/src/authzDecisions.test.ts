import './db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { isolatedAuth } from './testSupport.js'

const t = isolatedAuth()
after(() => t.restore())

const authz = await import('./authz.js')
const { setInstancePermissions } = await import('./authzInstanceStore.js')
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
  permission?: Parameters<typeof setInstancePermissions>[2][number]
  reason: string
  /** A scoped admin is rejected. */
  adminUnscopedOnly?: boolean
}

const INSTANCE_CASES: InstanceCase[] = [
  { action: 'tokens.manage', permission: 'manage_own_tokens', reason: 'Missing permission manage_own_tokens' },
  { action: 'cli.device.approve', permission: 'cli_device_approve', reason: 'Missing permission cli_device_approve' },
  { action: 'audit.view', permission: 'view_audit', reason: 'Missing permission view_audit' },
  { action: 'lineage.view', permission: 'view_lineage', reason: 'Missing permission view_lineage' },
  { action: 'store.admin', reason: 'Requires instance admin', adminUnscopedOnly: true },
  { action: 'instance.admin', reason: 'Forbidden' },
  { action: 'directory.sync', reason: 'Instance admin required' },
  { action: 'namespace.create', permission: 'create_namespace', reason: 'Missing permission create_namespace' },
  { action: 'access.review.all', permission: 'create_namespace', reason: 'Forbidden' },
  { action: 'session.admin', permission: 'session_admin', reason: 'Missing permission session_admin' },
  { action: 'session.create', permission: 'session_create', reason: 'Missing permission session_create' },
  { action: 'session.connect', permission: 'session_connect', reason: 'Missing permission session_connect' },
]

describe('decideInstanceAction matrix', () => {
  for (const c of INSTANCE_CASES) {
    describe(c.action, async () => {
      const holder = t.person(`holder-${c.action}`)
      const none = t.person(`none-${c.action}`)
      await preparePrincipal(holder)
      await preparePrincipal(none)
      if (c.permission) await setInstancePermissions(admin, holder, [c.permission], Date.now() + 86_400_000)

      it('admin allows', async () => {
        assert.deepEqual(await decideInstanceAction(admin, c.action), ALLOW)
      })

      if (c.permission) {
        it('named permission allows', async () => {
          assert.deepEqual(await decideInstanceAction(holder, c.action), ALLOW)
        })
      }

      it('scoped credential', async () => {
        const expectedAdmin = c.adminUnscopedOnly ? deny(c.reason) : ALLOW
        assert.deepEqual(await decideInstanceAction(scoped(admin) as never, c.action), expectedAdmin)
        if (c.permission) assert.deepEqual(await decideInstanceAction(scoped(holder) as never, c.action), ALLOW)
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

      it('admin and owner allow', async () => {
        assert.deepEqual(await decideNamespaceAction(owner, 'ns1', c.action), ALLOW)
        assert.deepEqual(await decideNamespaceAction(admin, 'ns1', c.action), ALLOW)
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

  it('access review: admin, create_namespace or a review capability; others deny', async () => {
    await createNamespaceAuthz(creator, 'ns2', 'none')
    const role = await createCustomNamespaceRole('ns2', { name: 'R', permissions: ['review_access_requests'] })
    if (role.ok) await setNamespaceMember('ns2', reviewer, role.role.id)
    await setInstancePermissions(admin, creator, ['create_namespace'], Date.now() + 86_400_000)
    assert.deepEqual(await decideAccessReview(admin), ALLOW)
    assert.deepEqual(await decideAccessReview(creator), ALLOW)
    assert.deepEqual(await decideAccessReview(reviewer), ALLOW)
    assert.deepEqual(await decideAccessReview(none), deny('Forbidden'))
  })

  it('service principal management API is gone', () => {
    assert.equal('decideServicePrincipalManage' in authz, false)
  })

  it('repo collaborator management carries status and reason', async () => {
    assert.deepEqual(await authz.decideManageRepoCollaborators(admin, 'ns2', 'r'), ALLOW)
    assert.deepEqual(await authz.decideManageRepoCollaborators(none, 'ns2', 'r'), deny('Forbidden'))
  })

  it('scoped-credential rule lives in one helper', async () => {
    assert.equal(await authz.isUnscopedInstanceAdmin(admin), true)
    assert.equal(await authz.isUnscopedInstanceAdmin(scoped(admin) as never), false)
    assert.equal(await authz.isUnscopedInstanceAdmin(none), false)
  })
})
