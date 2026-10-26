import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { breakTable } from '../../db/testDatabase.js'
import { isolatedAuth } from '../../testSupport.js'

const ctx = isolatedAuth()
after(() => ctx.restore())

const { offboard } = await import('./offboarding.js')
const { createServicePrincipal, getServicePrincipal } = await import('./servicePrincipals.js')
const { isCredentialRevoked } = await import('./credentialRevocation.js')
const { queryAudit } = await import('../../audit.js')

const owner = (sub: string) => ({ sub, iss: 'idp', email: `${sub}@x.io`, name: sub })

await describe('offboard result', async () => {
  await it('lists every step as completed when nothing fails', async () => {
    const o = owner('ok-owner')
    const sp = await createServicePrincipal({ name: 'ci', owner: o })
    assert.ok(sp.ok)
    const r = await offboard(o, { scope: 'all', cause: 'directory-sync' })
    assert.ok(r.ok)
    assert.deepEqual(r.failed, [])
    assert.deepEqual(r.completed, ['revoke-credentials', 'audit-revocation', 'suspend-service-principals', 'audit-suspensions'])
    assert.deepEqual(r.suspended, [sp.principal.id])
  })

  await it('lists only the steps that ran for a sessions-only offboard', async () => {
    const r = await offboard(owner('so'), { scope: 'sessions', cause: 'self-service' })
    assert.ok(r.ok)
    assert.deepEqual(r.completed, ['revoke-credentials', 'audit-revocation'])
  })

  await it('continues past a failed credential revocation and reports it', async () => {
    const o = owner('rev-fail')
    const sp = await createServicePrincipal({ name: 'ci', owner: o })
    assert.ok(sp.ok)
    const restore = await breakTable('session_revocations')
    let r
    try {
      r = await offboard(o, { scope: 'all', cause: 'directory-sync' })
    } finally {
      await restore()
    }
    assert.equal(r.ok, false)
    assert.ok(!r.ok && 'failed' in r)
    if (r.ok || !('failed' in r)) return
    assert.deepEqual(r.failed.map((f) => f.step), ['revoke-credentials', 'audit-revocation'])
    assert.match(r.failed[0]!.error, /session_revocations/)
    assert.deepEqual(r.completed, ['suspend-service-principals', 'audit-suspensions'])
    assert.equal((await getServicePrincipal(sp.principal.id))?.status, 'suspended')
    assert.equal(await isCredentialRevoked(o, 0, 'session'), false)
  })

  await it('reports a failed suspension while the revocation stands, and a retry completes it', async () => {
    const o = owner('sp-fail')
    const sp = await createServicePrincipal({ name: 'ci', owner: o })
    assert.ok(sp.ok)
    const restore = await breakTable('service_principals')
    let r
    try {
      r = await offboard(o, { scope: 'all', cause: 'directory-sync' })
    } finally {
      await restore()
    }
    assert.ok(!r.ok && 'failed' in r)
    if (r.ok || !('failed' in r)) return
    assert.deepEqual(r.failed.map((f) => f.step), ['suspend-service-principals'])
    assert.deepEqual(r.completed, ['revoke-credentials', 'audit-revocation'])
    assert.equal(await isCredentialRevoked(o, 0, 'session'), true)
    assert.equal((await getServicePrincipal(sp.principal.id))?.status, 'active')

    const retry = await offboard(o, { scope: 'all', cause: 'directory-sync' })
    assert.ok(retry.ok)
    assert.deepEqual(retry.suspended, [sp.principal.id])
  })

  await it('keeps audit actions unchanged', async () => {
    const o = owner('audited')
    await createServicePrincipal({ name: 'ci', owner: o })
    await offboard(o, { scope: 'all', cause: 'directory-sync' })
    assert.equal((await queryAudit({ action: 'session.revoke' })).events.length > 0, true)
    assert.equal((await queryAudit({ action: 'service-principal.suspend' })).events.length > 0, true)
  })
})
