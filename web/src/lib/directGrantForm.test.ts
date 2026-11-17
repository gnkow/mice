import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildDirectGrantBodies } from './directGrantForm'

describe('RBAC S36 direct grant form', () => {
  it('builds role and/or permission grant bodies with expiry (reason is signed separately)', () => {
    const expiresAt = 1_800_000_000_000
    assert.deepEqual(
      buildDirectGrantBodies({
        sub: 'u1',
        iss: 'https://idp.test',
        role: 'manager',
        permissions: [],
        expiresAt,
      }),
      {
        ok: true,
        bodies: [
          {
            kind: 'role',
            body: {
              sub: 'u1',
              iss: 'https://idp.test',
              role: 'manager',
              expiresAt,
            },
          },
        ],
      },
    )

    assert.deepEqual(
      buildDirectGrantBodies({
        sub: 'u1',
        iss: 'https://idp.test',
        role: null,
        permissions: ['namespace:create', 'audit:read'],
        expiresAt,
      }),
      {
        ok: true,
        bodies: [
          {
            kind: 'permissions',
            body: {
              sub: 'u1',
              iss: 'https://idp.test',
              permissions: ['namespace:create', 'audit:read'],
              expiresAt,
            },
          },
        ],
      },
    )

    const both = buildDirectGrantBodies({
      sub: 'u1',
      iss: 'https://idp.test',
      role: 'user',
      permissions: ['audit:read'],
      expiresAt,
    })
    assert.equal(both.ok, true)
    if (!both.ok) throw new Error('expected ok')
    assert.equal(both.bodies.length, 2)
    assert.equal(both.bodies[0]!.kind, 'role')
    assert.equal(both.bodies[1]!.kind, 'permissions')
  })

  it('rejects missing target, grant, or expiry', () => {
    const expiresAt = 1_800_000_000_000
    assert.equal(
      buildDirectGrantBodies({
        sub: '',
        iss: 'https://idp.test',
        role: 'user',
        permissions: [],
        expiresAt,
      }).ok,
      false,
    )
    assert.equal(
      buildDirectGrantBodies({
        sub: 'u1',
        iss: 'https://idp.test',
        role: null,
        permissions: [],
        expiresAt,
      }).ok,
      false,
    )
    assert.equal(
      buildDirectGrantBodies({
        sub: 'u1',
        iss: 'https://idp.test',
        role: 'user',
        permissions: [],
        expiresAt: 0,
      }).ok,
      false,
    )
  })
})
