import './db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ensurePrincipal } from './authentication/session/session.js'
import { assignRole, getUserRole } from './rbacStore.js'

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
