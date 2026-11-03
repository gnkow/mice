import './db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ensurePrincipal } from './authentication/session/session.js'
import { assignRole, grantCustomPermissions, listRbacUsers } from './rbacStore.js'

const person = (sub: string) => ({
  sub,
  iss: 'https://idp.test',
  email: `${sub}@example.com`,
  name: sub,
})

describe('RBAC S36 list users for Grant Access', () => {
  it('returns principals with role and custom permission count', async () => {
    const a = person('list-user-a')
    const b = person('list-user-b')
    await ensurePrincipal(a)
    await ensurePrincipal(b)
    assert.equal(
      (
        await assignRole({
          actor: null,
          target: a,
          role: 'user',
          reason: 'boot',
          bootstrap: true,
        })
      ).ok,
      true,
    )
    assert.equal(
      (
        await grantCustomPermissions({
          actor: null,
          target: a,
          permissions: ['namespace:create', 'audit:read'],
          reason: 'extra',
          expiresAt: Date.now() + 86_400_000,
          bootstrap: true,
        })
      ).ok,
      true,
    )

    const users = await listRbacUsers()
    const rowA = users.find((u) => u.sub === a.sub)
    const rowB = users.find((u) => u.sub === b.sub)
    assert.ok(rowA)
    assert.equal(rowA!.role, 'user')
    assert.equal(rowA!.customPermissionCount, 2)
    assert.equal(rowA!.email, a.email)
    assert.ok(rowB)
    assert.equal(rowB!.role, null)
    assert.equal(rowB!.customPermissionCount, 0)
  })
})
