import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { isolatedAuth } from './testSupport.js'

// AUTHZ_ENFORCE unset so the stored flag drives enforcement and tests can flip it.
const t = isolatedAuth({ AUTHZ_ENFORCE: '' })
after(() => t.restore())

const authz = await import('./authz.js')
const { setAuthzEnforce, setInstancePermissions } = await import('./authzInstanceStore.js')
const { createNamespaceAuthz } = await import('./authzNamespaceStore.js')
const { setNamespaceMember } = await import('./authzMembershipStore.js')
const { createCustomNamespaceRole } = await import('./customRoles.js')
const { decideInstanceAction, decideNamespaceAction, decideAccessReview, decideServicePrincipalManage, preparePrincipal } = authz

const admin = t.admin
preparePrincipal(admin)
const scoped = <T extends object>(u: T) => ({ ...u, patScopes: [{ namespace: 'x', maxRole: 'read' as const }] })
const enforce = (on: boolean) => setAuthzEnforce(on)

const ALLOW = { allow: true, status: 200, reason: 'ok' }
const deny = (reason: string) => ({ allow: false, status: 403, reason })

type InstanceCase = {
  action: Parameters<typeof decideInstanceAction>[1]
  permission?: Parameters<typeof setInstancePermissions>[2][number]
  reason: string
  /** Decided even when enforcement is off. */
  alwaysDecided?: boolean
  /** A scoped admin is rejected. */
  adminUnscopedOnly?: boolean
}

const INSTANCE_CASES: InstanceCase[] = [
  { action: 'tokens.manage', permission: 'manage_own_tokens', reason: 'Missing permission manage_own_tokens' },
  { action: 'cli.device.approve', permission: 'cli_device_approve', reason: 'Missing permission cli_device_approve' },
  { action: 'audit.view', permission: 'view_audit', reason: 'Missing permission view_audit' },
  { action: 'lineage.view', permission: 'view_lineage', reason: 'Missing permission view_lineage' },
  { action: 'store.admin', reason: 'Requires instance admin', adminUnscopedOnly: true },
  { action: 'instance.admin', reason: 'Forbidden', alwaysDecided: true },
  { action: 'serviceprincipal.admin', reason: 'Instance admin required', alwaysDecided: true },
  { action: 'directory.sync', reason: 'Instance admin required', alwaysDecided: true },
  { action: 'namespace.create', permission: 'create_namespace', reason: 'Missing permission create_namespace', alwaysDecided: true },
  { action: 'access.review.all', permission: 'create_namespace', reason: 'Forbidden', alwaysDecided: true },
  { action: 'session.admin', permission: 'session_admin', reason: 'Missing permission session_admin', alwaysDecided: true },
  { action: 'session.create', permission: 'session_create', reason: 'Missing permission session_create' },
  { action: 'session.connect', permission: 'session_connect', reason: 'Missing permission session_connect' },
]

describe('decideInstanceAction matrix', () => {
  for (const c of INSTANCE_CASES) {
    describe(c.action, () => {
      const holder = t.person(`holder-${c.action}`)
      const none = t.person(`none-${c.action}`)
      preparePrincipal(holder)
      preparePrincipal(none)
      if (c.permission) setInstancePermissions(admin, holder, [c.permission])

      it('enforce off', () => {
        enforce(false)
        const expected = c.alwaysDecided ? deny(c.reason) : ALLOW
        assert.deepEqual(decideInstanceAction(none, c.action), expected)
        assert.deepEqual(decideInstanceAction(admin, c.action), ALLOW)
      })

      it('admin allows', () => {
        enforce(true)
        assert.deepEqual(decideInstanceAction(admin, c.action), ALLOW)
      })

      if (c.permission) {
        it('named permission allows', () => {
          enforce(true)
          assert.deepEqual(decideInstanceAction(holder, c.action), ALLOW)
        })
      }

      it('scoped credential', () => {
        enforce(true)
        const expectedAdmin = c.adminUnscopedOnly ? deny(c.reason) : ALLOW
        assert.deepEqual(decideInstanceAction(scoped(admin) as never, c.action), expectedAdmin)
        if (c.permission) assert.deepEqual(decideInstanceAction(scoped(holder) as never, c.action), ALLOW)
      })

      it('none denies with the recorded reason', () => {
        enforce(true)
        assert.deepEqual(decideInstanceAction(none, c.action), deny(c.reason))
      })
    })
  }
})

describe('decideNamespaceAction matrix', () => {
  const owner = t.person('ns-owner')
  const member = t.person('ns-member')
  const reviewer = t.person('ns-reviewer')
  const none = t.person('ns-none')
  for (const u of [owner, member, reviewer, none]) preparePrincipal(u)
  createNamespaceAuthz(owner, 'ns1', 'read')
  setNamespaceMember('ns1', member, 'member')
  const role = createCustomNamespaceRole('ns1', { name: 'Reviewer', permissions: ['review_access_requests', 'manage_settings'] })
  assert.ok(role.ok)
  if (role.ok) setNamespaceMember('ns1', reviewer, role.role.id)

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
      it('is not gated by the enforce flag', () => {
        enforce(false)
        assert.deepEqual(decideNamespaceAction(none, 'ns1', c.action), deny(c.reason))
        assert.deepEqual(decideNamespaceAction(owner, 'ns1', c.action), ALLOW)
      })

      it('admin and owner allow', () => {
        enforce(true)
        assert.deepEqual(decideNamespaceAction(owner, 'ns1', c.action), ALLOW)
        assert.deepEqual(decideNamespaceAction(admin, 'ns1', c.action), ALLOW)
      })

      if (c.named) {
        it('named capability or membership allows', () => {
          enforce(true)
          assert.deepEqual(decideNamespaceAction(c.named, 'ns1', c.action), ALLOW)
        })
      }

      it('scoped credential', () => {
        enforce(true)
        const scopedReviewer = scoped(reviewer) as never
        const expected = 'unscopedOnly' in c ? deny(c.reason) : c.named ? ALLOW : deny(c.reason)
        assert.deepEqual(decideNamespaceAction(scopedReviewer, 'ns1', c.action), expected)
      })

      it('none denies with the recorded reason', () => {
        enforce(true)
        assert.deepEqual(decideNamespaceAction(none, 'ns1', c.action), deny(c.reason))
        assert.deepEqual(decideNamespaceAction(member, 'ns1', c.action), c.named === member ? ALLOW : deny(c.reason))
      })
    })
  }
})

describe('composite decisions', () => {
  const none = t.person('comp-none')
  const creator = t.person('comp-creator')
  const reviewer = t.person('comp-reviewer')
  for (const u of [none, creator, reviewer]) preparePrincipal(u)

  it('access review: admin, create_namespace or a review capability; others deny; enforce irrelevant', () => {
    createNamespaceAuthz(creator, 'ns2', 'none')
    const role = createCustomNamespaceRole('ns2', { name: 'R', permissions: ['review_access_requests'] })
    if (role.ok) setNamespaceMember('ns2', reviewer, role.role.id)
    setInstancePermissions(admin, creator, ['create_namespace'])
    for (const on of [true, false]) {
      enforce(on)
      assert.deepEqual(decideAccessReview(admin), ALLOW)
      assert.deepEqual(decideAccessReview(creator), ALLOW)
      assert.deepEqual(decideAccessReview(reviewer), ALLOW)
      assert.deepEqual(decideAccessReview(none), deny('Forbidden'))
    }
  })

  it('service principal management: admin or owner', () => {
    enforce(true)
    assert.deepEqual(decideServicePrincipalManage(admin, false), ALLOW)
    assert.deepEqual(decideServicePrincipalManage(none, true), ALLOW)
    assert.deepEqual(decideServicePrincipalManage(none, false), deny('Forbidden'))
  })

  it('repo collaborator management carries status and reason', () => {
    enforce(true)
    assert.deepEqual(authz.decideManageRepoCollaborators(admin, 'ns2', 'r'), ALLOW)
    assert.deepEqual(authz.decideManageRepoCollaborators(none, 'ns2', 'r'), deny('Forbidden'))
  })

  it('scoped-credential rule lives in one helper', () => {
    assert.equal(authz.isUnscopedInstanceAdmin(admin), true)
    assert.equal(authz.isUnscopedInstanceAdmin(scoped(admin) as never), false)
    assert.equal(authz.isUnscopedInstanceAdmin(none), false)
  })
})
