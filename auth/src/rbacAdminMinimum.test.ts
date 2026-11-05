import './db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { assignRole, getUserRole, revokeRole } from './rbacStore.js'

const person = (sub: string) => ({ sub, iss: 'https://idp.test', email: `${sub}@example.com`, emailVerified: true as const, name: sub })
const makeAdmin = (u: ReturnType<typeof person>) =>
  assignRole({ actor: null, target: u, role: 'admin', reason: 'boot', bootstrap: true })
const MIN = 'At least two admins must remain'

describe('Admin role minimum (#20)', () => {
  it('refuses to revoke or demote an Admin while only two remain, and allows it with three', async () => {
    const [a, b, c] = [person('min-a'), person('min-b'), person('min-c')]
    for (const u of [a, b]) assert.equal((await makeAdmin(u)).ok, true)

    assert.deepEqual(await revokeRole({ actor: a, target: b, reason: 'leaving' }), { ok: false, error: MIN })
    assert.deepEqual(
      await assignRole({ actor: a, target: b, role: 'manager', reason: 'demote', expiresAt: Date.now() + 60_000 }),
      { ok: false, error: MIN },
    )
    assert.equal(await getUserRole(b), 'admin')

    assert.equal((await makeAdmin(c)).ok, true)
    assert.equal((await revokeRole({ actor: a, target: c, reason: 'leaving' })).ok, true)
    assert.equal(await getUserRole(c), null)
  })
})
