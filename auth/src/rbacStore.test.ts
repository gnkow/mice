import './db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ensurePrincipal } from './authentication/session/session.js'
import { assignRole, getUserRole, listRoleHistory, revokeRole } from './rbacStore.js'

const dayMs = 24 * 60 * 60 * 1000

const person = (sub: string) => ({
  sub,
  iss: 'https://idp.test',
  email: `${sub}@example.com`,
  name: sub,
})

describe('RBAC S04 assign role', () => {
  it('refuses a delegated role grant without expiresAt', async () => {
    const actor = person('actor-s04')
    const target = person('target-no-expiry')
    await ensurePrincipal(actor)
    await ensurePrincipal(target)
    const result = await assignRole({
      actor,
      target,
      role: 'user',
      reason: 'onboarding',
    })
    assert.equal(result.ok, false)
    if (result.ok) throw new Error('expected failure')
    assert.match(result.error, /expir/i)
    assert.equal(await getUserRole(target), null)
  })

  it('assigns a delegated role with future expiresAt', async () => {
    const actor = person('actor-s04b')
    const target = person('target-user')
    await ensurePrincipal(actor)
    await ensurePrincipal(target)
    const expiresAt = Date.now() + 30 * dayMs
    const result = await assignRole({
      actor,
      target,
      role: 'user',
      reason: 'approved request',
      expiresAt,
    })
    assert.equal(result.ok, true)
    assert.equal(await getUserRole(target), 'user')
  })

  it('allows bootstrap role assign without expiresAt', async () => {
    const target = person('bootstrap-admin')
    await ensurePrincipal(target)
    const result = await assignRole({
      actor: null,
      target,
      role: 'admin',
      reason: 'bootstrap',
      bootstrap: true,
    })
    assert.equal(result.ok, true)
    assert.equal(await getUserRole(target), 'admin')
  })
})

describe('RBAC S05 revoke and replace role', () => {
  it('replaces an active role and appends grant/revoke history', async () => {
    const actor = person('actor-s05')
    const target = person('target-replace')
    await ensurePrincipal(actor)
    await ensurePrincipal(target)
    const expiresAt = Date.now() + 30 * dayMs
    assert.equal(
      (
        await assignRole({
          actor,
          target,
          role: 'user',
          reason: 'first',
          expiresAt,
        })
      ).ok,
      true,
    )
    assert.equal(
      (
        await assignRole({
          actor,
          target,
          role: 'manager',
          reason: 'upgrade',
          expiresAt,
        })
      ).ok,
      true,
    )
    assert.equal(await getUserRole(target), 'manager')
    const history = await listRoleHistory(target)
    assert.deepEqual(
      history.map((h) => ({ role: h.role, action: h.action })),
      [
        { role: 'user', action: 'granted' },
        { role: 'user', action: 'revoked' },
        { role: 'manager', action: 'granted' },
      ],
    )
  })

  it('revokes the active role and records history', async () => {
    const actor = person('actor-s05b')
    const target = person('target-revoke')
    await ensurePrincipal(actor)
    await ensurePrincipal(target)
    assert.equal(
      (
        await assignRole({
          actor,
          target,
          role: 'external',
          reason: 'temp',
          expiresAt: Date.now() + dayMs,
        })
      ).ok,
      true,
    )
    const revoked = await revokeRole({
      actor,
      target,
      reason: 'no longer needed',
    })
    assert.equal(revoked.ok, true)
    assert.equal(await getUserRole(target), null)
    const history = await listRoleHistory(target)
    assert.equal(history.at(-1)?.action, 'revoked')
    assert.equal(history.at(-1)?.role, 'external')
    assert.equal(history.at(-1)?.revokeReason, 'no longer needed')
  })
})
