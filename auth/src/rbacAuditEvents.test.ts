import './db/testSchema.js'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { queryAudit } from './audit.js'
import { ensurePrincipal } from './authentication/session/session.js'
import {
  assignRole,
  grantCustomPermissions,
  revokeCustomPermissions,
  revokeRole,
} from './rbacStore.js'

process.env.AUTHZ_REQUIRE_TRAINING = 'false'

const person = (sub: string) => ({
  sub,
  iss: 'https://idp.test',
  email: `${sub}@example.com`,
  emailVerified: true as const,
  name: sub,
})

describe('RBAC S28 Immudb role/permission audit events', () => {
  it('records role.assign and role.revoke via the audit query seam', async () => {
    const actor = person('audit-actor')
    const target = person('audit-target')
    await ensurePrincipal(actor)
    await ensurePrincipal(target)

    assert.equal(
      (
        await assignRole({
          actor,
          target,
          role: 'user',
          reason: 'onboard',
          expiresAt: Date.now() + 86_400_000,
          accessRequestId: 'req-s28',
        })
      ).ok,
      true,
    )

    const assigned = (await queryAudit({ action: 'role.assign', actor: 'audit-actor' })).events
    assert.equal(assigned.length, 1)
    assert.equal(assigned[0]!.detail?.role, 'user')
    assert.equal(assigned[0]!.detail?.access_request_id, 'req-s28')
    assert.deepEqual(assigned[0]!.detail?.target, { sub: target.sub, iss: target.iss })
    assert.equal(assigned[0]!.reason, 'onboard')

    assert.equal((await revokeRole({ actor, target, reason: 'offboard' })).ok, true)
    const revoked = (await queryAudit({ action: 'role.revoke', actor: 'audit-actor' })).events
    assert.equal(revoked.length, 1)
    assert.equal(revoked[0]!.detail?.role, 'user')
    assert.equal(revoked[0]!.reason, 'offboard')
  })

  it('records permission.grant and permission.revoke via the audit query seam', async () => {
    const actor = person('audit-perm-actor')
    const target = person('audit-perm-target')
    await ensurePrincipal(actor)
    await ensurePrincipal(target)

    assert.equal(
      (
        await grantCustomPermissions({
          actor,
          target,
          permissions: ['repo:bypass_acl'],
          reason: 'temp-audit',
          expiresAt: Date.now() + 86_400_000,
          accessRequestId: 'req-perm-s28',
        })
      ).ok,
      true,
    )

    const granted = (await queryAudit({ action: 'permission.grant', actor: 'audit-perm-actor' })).events
    assert.equal(granted.length, 1)
    assert.deepEqual(granted[0]!.detail?.permissions, ['repo:bypass_acl'])
    assert.equal(granted[0]!.detail?.access_request_id, 'req-perm-s28')

    assert.equal(
      (
        await revokeCustomPermissions({
          actor,
          target,
          permissions: ['repo:bypass_acl'],
          reason: 'done',
        })
      ).ok,
      true,
    )
    const revoked = (await queryAudit({ action: 'permission.revoke', actor: 'audit-perm-actor' })).events
    assert.equal(revoked.length, 1)
    assert.deepEqual(revoked[0]!.detail?.permissions, ['repo:bypass_acl'])
  })
})
