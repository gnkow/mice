import './db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { isolatedAuth } from './testSupport.js'

const iso = isolatedAuth()
after(() => iso.restore())

const { authorizeAuditQuery } = await import('./authzAudit.js')
const { preparePrincipal } = await import('./authz.js')
const { createNamespaceAuthz } = await import('./authzNamespaceStore.js')
const { setNamespaceMember } = await import('./authzMembershipStore.js')
const { writeInstancePermissions } = await import('./authzInstanceStore.js')

const admin = iso.admin
await preparePrincipal(admin)

describe('authorizeAuditQuery', () => {
  it('allows instance audit:read without namespace force', async () => {
    const auditor = iso.person('authz-audit-reader')
    await preparePrincipal(auditor)
    await iso.grantRole(auditor, 'auditor')
    const gate = await authorizeAuditQuery(auditor, undefined)
    assert.deepEqual(gate, { allow: true })
  })

  it('denies a principal with no audit scope', async () => {
    const outsider = iso.person('authz-audit-outsider')
    await preparePrincipal(outsider)
    await writeInstancePermissions(outsider, [])
    const gate = await authorizeAuditQuery(outsider, undefined)
    assert.equal(gate.allow, false)
    assert.match(gate.reason ?? '', /view_audit/)
  })

  it('scopes an owner to their namespace and denies a foreign one', async () => {
    const ns = `authz-audit-ns-${Date.now().toString(36)}`
    await createNamespaceAuthz(admin, ns, 'none', true)
    const owner = iso.person('authz-audit-owner')
    await preparePrincipal(owner)
    await writeInstancePermissions(owner, [])
    await setNamespaceMember(ns, owner, 'owner')

    const scoped = await authorizeAuditQuery(owner, ns)
    assert.equal(scoped.allow, true)
    assert.equal(scoped.forceNamespace, ns)

    const foreign = await authorizeAuditQuery(owner, 'not-their-ns')
    assert.equal(foreign.allow, false)
    assert.match(foreign.reason ?? '', /Not allowed/)
  })

  it('returns ownedOnly when the caller owns multiple namespaces', async () => {
    const a = `authz-audit-a-${Date.now().toString(36)}`
    const b = `authz-audit-b-${Date.now().toString(36)}`
    await createNamespaceAuthz(admin, a, 'none', true)
    await createNamespaceAuthz(admin, b, 'none', true)
    const owner = iso.person('authz-audit-multi')
    await preparePrincipal(owner)
    await writeInstancePermissions(owner, [])
    await setNamespaceMember(a, owner, 'owner')
    await setNamespaceMember(b, owner, 'owner')

    const gate = await authorizeAuditQuery(owner, undefined)
    assert.equal(gate.allow, true)
    assert.ok(gate.ownedOnly?.includes(a))
    assert.ok(gate.ownedOnly?.includes(b))
    assert.equal(gate.forceNamespace, undefined)
  })
})
