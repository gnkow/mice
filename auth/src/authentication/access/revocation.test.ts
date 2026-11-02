import '../../db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  confirmSuspension,
  consumeBackChannelJti,
  isPrincipalAccessRevoked,
  isRevoked,
  listPendingSuspensions,
  revokeAll,
  revokeOnRoleChange,
  selfSuspend,
  suspend,
} from './revocation.js'

const unique = (prefix: string) => ({
  iss: 'https://idp.example.com',
  sub: `${prefix}-${Math.random().toString(36).slice(2)}`,
})

const admin = unique('admin')
const admin2 = unique('admin2')

describe('Revocation and Suspension (Ticket 06)', () => {
  it('revokes every credential and blocks a fresh login immediately', async () => {
    const target = unique('revoke')
    await revokeAll(target, { revokedBy: admin, reason: 'security incident' })

    assert.equal(await isRevoked(target), true)
    assert.equal(await isPrincipalAccessRevoked(target), true)
  })

  it('checks live with no cache', async () => {
    const target = unique('cache')
    assert.equal(await isRevoked(target), false)
    await revokeAll(target, { revokedBy: admin, reason: 'test' })
    assert.equal(await isRevoked(target), true)
  })

  it('does not revoke when the audit Intent cannot be appended', async () => {
    const target = unique('audit-revoke')
    await assert.rejects(
      revokeAll(target, { revokedBy: admin, reason: 'test', auditFailure: true }),
      (err: unknown) => (err as { status?: number }).status === 503,
    )
    assert.equal(await isRevoked(target), false)
  })

  it('does not request a suspension when the audit Intent cannot be appended', async () => {
    const target = unique('audit-suspend')
    await assert.rejects(
      suspend(target, { suspendedBy: admin, reason: 'test', auditFailure: true }),
      (err: unknown) => (err as { status?: number }).status === 503,
    )
    assert.equal((await listPendingSuspensions()).some((s) => s.principal.sub === target.sub), false)
  })

  it('keeps a suspension pending until a second admin confirms it', async () => {
    const target = unique('suspend')
    const requestId = await suspend(target, { suspendedBy: admin, reason: 'suspected compromise' })

    assert.equal(await isPrincipalAccessRevoked(target), false)
    assert.ok((await listPendingSuspensions()).some((s) => s.id === requestId))

    await confirmSuspension(requestId, { confirmedBy: admin2, reason: 'confirmed' })

    assert.equal(await isPrincipalAccessRevoked(target), true)
    assert.equal(await isRevoked(target), false)
    assert.equal((await listPendingSuspensions()).some((s) => s.id === requestId), false)
  })

  it('rejects confirmation by the admin who initiated the suspension', async () => {
    const target = unique('same-admin')
    const requestId = await suspend(target, { suspendedBy: admin, reason: 'test' })
    await assert.rejects(
      confirmSuspension(requestId, { confirmedBy: admin, reason: 'test' }),
      /different admin/,
    )
    assert.equal(await isPrincipalAccessRevoked(target), false)
    await confirmSuspension(requestId, { confirmedBy: admin2, reason: 'cleanup' })
  })

  it('drops an unconfirmed suspension after 24 hours', async () => {
    const target = unique('expired')
    const requestId = await suspend(target, { suspendedBy: admin, reason: 'test' })
    const realNow = Date.now
    try {
      Date.now = () => realNow() + 25 * 60 * 60 * 1000
      assert.equal((await listPendingSuspensions()).some((s) => s.id === requestId), false)
      await assert.rejects(
        confirmSuspension(requestId, { confirmedBy: admin2, reason: 'too late' }),
        /not found or expired/,
      )
    } finally {
      Date.now = realNow
    }
    assert.equal(await isPrincipalAccessRevoked(target), false)
  })

  it('suspends the caller immediately without confirmation', async () => {
    const target = unique('self')
    await selfSuspend(target, { reason: 'panic' })
    assert.equal(await isPrincipalAccessRevoked(target), true)
    assert.equal(await isRevoked(target), false)
  })

  it('ends Sessions on a role change but leaves PATs and fresh logins alone', async () => {
    const target = unique('role')
    const sessionStart = Math.floor(Date.now() / 1000) - 10
    await revokeOnRoleChange(target, { changedBy: admin, reason: 'role changed' })

    assert.equal(await isRevoked(target, { sessionStart }), true)
    assert.equal(await isRevoked(target), false)
    assert.equal(await isPrincipalAccessRevoked(target), false)
    assert.equal(await isRevoked(target, { sessionStart: sessionStart + 60 }), false)
  })

  it('ends Sessions for every affected Principal when a role definition changes', async () => {
    const a = unique('role-a')
    const b = unique('role-b')
    const start = Math.floor(Date.now() / 1000) - 10
    await revokeOnRoleChange([a, b], { changedBy: admin, reason: 'role definition edited' })
    assert.equal(await isRevoked(a, { sessionStart: start }), true)
    assert.equal(await isRevoked(b, { sessionStart: start }), true)
  })

  it('consumes a back-channel logout jti once and rejects the replay', async () => {
    const jti = `jti-${Math.random().toString(36).slice(2)}`
    const expiresAt = Math.floor(Date.now() / 1000) + 300
    assert.equal(await consumeBackChannelJti(jti, expiresAt), true)
    assert.equal(await consumeBackChannelJti(jti, expiresAt), false)
  })
})
