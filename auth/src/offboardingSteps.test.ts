import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { useJsonBackend, type JsonBackend } from './jsonStore.js'
import { isolatedAuth } from './testSupport.js'

const ctx = isolatedAuth()
after(() => ctx.restore())

const { offboard } = await import('./offboarding.js')
const { createServicePrincipal, getServicePrincipal } = await import('./servicePrincipals.js')
const { isCredentialRevoked } = await import('./credentialRevocation.js')
const { queryAudit } = await import('./audit.js')

const failingWrites = (pattern: string): (() => void) => {
  const inner: JsonBackend = ctx.backend
  return useJsonBackend({
    read: (p) => inner.read(p),
    write: (p, t, o) => {
      if (p.includes(pattern)) throw new Error(`disk full: ${pattern}`)
      inner.write(p, t, o)
    },
    append: (p, t) => inner.append!(p, t),
  })
}

const owner = (sub: string) => ({ sub, iss: 'idp', email: `${sub}@x.io`, name: sub })

describe('offboard result', () => {
  it('lists every step as completed when nothing fails', () => {
    const o = owner('ok-owner')
    const sp = createServicePrincipal({ name: 'ci', owner: o })
    assert.ok(sp.ok)
    const r = offboard(o, { scope: 'all', cause: 'directory-sync' })
    assert.ok(r.ok)
    assert.deepEqual(r.failed, [])
    assert.deepEqual(r.completed, ['revoke-credentials', 'audit-revocation', 'suspend-service-principals', 'audit-suspensions'])
    assert.deepEqual(r.suspended, [sp.principal.id])
  })

  it('lists only the steps that ran for a sessions-only offboard', () => {
    const r = offboard(owner('so'), { scope: 'sessions', cause: 'self-service' })
    assert.ok(r.ok)
    assert.deepEqual(r.completed, ['revoke-credentials', 'audit-revocation'])
  })

  it('continues past a failed credential revocation and reports it', () => {
    const o = owner('rev-fail')
    const sp = createServicePrincipal({ name: 'ci', owner: o })
    assert.ok(sp.ok)
    const restore = failingWrites('session-revocations')
    let r
    try {
      r = offboard(o, { scope: 'all', cause: 'directory-sync' })
    } finally {
      restore()
    }
    assert.equal(r.ok, false)
    assert.ok(!r.ok && 'failed' in r)
    if (r.ok || !('failed' in r)) return
    assert.deepEqual(r.failed.map((f) => f.step), ['revoke-credentials', 'audit-revocation'])
    assert.match(r.failed[0]!.error, /disk full/)
    assert.deepEqual(r.completed, ['suspend-service-principals', 'audit-suspensions'])
    assert.equal(getServicePrincipal(sp.principal.id)?.status, 'suspended')
    assert.equal(isCredentialRevoked(o, 0, 'session'), false)
  })

  it('reports a failed suspension while the revocation stands, and a retry completes it', () => {
    const o = owner('sp-fail')
    const sp = createServicePrincipal({ name: 'ci', owner: o })
    assert.ok(sp.ok)
    const restore = failingWrites('service-principals')
    let r
    try {
      r = offboard(o, { scope: 'all', cause: 'directory-sync' })
    } finally {
      restore()
    }
    assert.ok(!r.ok && 'failed' in r)
    if (r.ok || !('failed' in r)) return
    assert.deepEqual(r.failed.map((f) => f.step), ['suspend-service-principals'])
    assert.deepEqual(r.completed, ['revoke-credentials', 'audit-revocation'])
    assert.equal(isCredentialRevoked(o, 0, 'session'), true)
    assert.equal(getServicePrincipal(sp.principal.id)?.status, 'active')

    const retry = offboard(o, { scope: 'all', cause: 'directory-sync' })
    assert.ok(retry.ok)
    assert.deepEqual(retry.suspended, [sp.principal.id])
  })

  it('keeps audit actions unchanged', () => {
    const o = owner('audited')
    createServicePrincipal({ name: 'ci', owner: o })
    offboard(o, { scope: 'all', cause: 'directory-sync' })
    assert.equal(queryAudit({ action: 'session.revoke' }).events.length > 0, true)
    assert.equal(queryAudit({ action: 'service-principal.suspend' }).events.length > 0, true)
  })
})
