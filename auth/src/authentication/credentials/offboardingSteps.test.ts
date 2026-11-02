import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import { breakTable } from '../../db/testDatabase.js'
import { isolatedAuth } from '../../testSupport.js'

const ctx = isolatedAuth()
after(() => ctx.restore())

const { offboard } = await import('./offboarding.js')
const { isCredentialRevoked } = await import('./credentialRevocation.js')
const { queryAudit } = await import('../../audit.js')

const owner = (sub: string) => ({ sub, iss: 'idp', email: `${sub}@x.io`, name: sub })

await describe('offboard result', async () => {
  await it('lists every step as completed when nothing fails', async () => {
    const r = await offboard(owner('ok-owner'), { scope: 'all', cause: 'directory-sync' })
    assert.ok(r.ok)
    assert.deepEqual(r.failed, [])
    assert.deepEqual(r.completed, ['revoke-credentials', 'audit-revocation'])
    assert.deepEqual(r.suspended, [])
  })

  await it('lists only the steps that ran for a sessions-only offboard', async () => {
    const r = await offboard(owner('so'), { scope: 'sessions', cause: 'self-service' })
    assert.ok(r.ok)
    assert.deepEqual(r.completed, ['revoke-credentials', 'audit-revocation'])
  })

  await it('continues past a failed credential revocation and reports it', async () => {
    const o = owner('rev-fail')
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
    assert.deepEqual(r.completed, [])
    assert.deepEqual(r.suspended, [])
    assert.equal(await isCredentialRevoked(o, 0, 'session'), false)
  })

  await it('keeps the revocation audit and does not suspend a service principal', async () => {
    const o = owner('audited')
    await offboard(o, { scope: 'all', cause: 'directory-sync' })
    assert.equal((await queryAudit({ action: 'session.revoke' })).events.length > 0, true)
    assert.equal((await queryAudit({ action: 'service-principal.suspend' })).events.length, 0)
  })
})
