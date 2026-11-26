/**
 * Tests for Principal access monitoring (Ticket 11)
 */

import '../../../../db/testSchema.js'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { getDb } from '../../../src/db/database.js'
import { principalRoles, principals } from '../../../src/db/schema.js'
import { setDirectoryFetchForTests } from '../../../src/packages/authentication/lib/directory/directory.js'
import { overrideEnv } from '../../../src/packages/shared/lib/env.js'
import { assignRole } from '../../../src/packages/authz/lib/rbacStore.js'
import {
  alarmsFromAccessSnapshots,
  checkDisabledPrincipalsWithSigningRights,
  createPrincipalAccessMonitor,
  decideHasSigningRights,
  getPrincipalAccessState,
  type AccessSnapshot,
} from '../../../src/packages/authentication/lib/compliance/principalAccessMonitoring.js'

async function grantSigningRole(sub: string, iss: string, role: 'user' | 'manager' | 'admin' = 'user') {
  assert.equal(
    (
      await assignRole({
        actor: null,
        target: { sub, iss },
        role,
        reason: 'test signing rights',
        bootstrap: true,
      })
    ).ok,
    true,
  )
}

function directoryFetch(disabled: (url: string) => boolean): (url: string) => Promise<Response> {
  return async (url) => {
    if (url.includes('/protocol/openid-connect/token')) {
      return new Response(JSON.stringify({ access_token: 'test-token', expires_in: 300 }), { status: 200 })
    }
    if (url.includes('/users/') && disabled(url)) {
      return new Response(JSON.stringify({ enabled: false, firstName: 'Disabled', lastName: 'User' }), { status: 200 })
    }
    if (url.includes('/users/')) {
      return new Response(JSON.stringify({ enabled: true, firstName: 'Enabled', lastName: 'User' }), { status: 200 })
    }
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } })
  }
}

describe('Principal Access Monitoring (Ticket 11)', () => {
  beforeEach(async () => {
    // permission_snapshots / role history are append-only — do not DELETE them.
    // Clear mutable role rows; Principals keep unique subs per test below.
    await getDb().delete(principalRoles)
    overrideEnv({
      directoryProvider: 'keycloak',
      keycloakAdminUrl: 'http://directory.test',
      keycloakRealm: 'mice',
      oidcClientId: 'mice-auth',
      oidcClientSecret: 'test-secret',
    })
    setDirectoryFetchForTests(directoryFetch((url) => url.includes('/users/disabled-user')))
  })

  describe('decideHasSigningRights', () => {
    it('grants rights to Approvers and write-capable instance roles only', () => {
      assert.equal(decideHasSigningRights({ instanceRole: null, isApprover: true }), true)
      assert.equal(decideHasSigningRights({ instanceRole: 'user', isApprover: false }), true)
      assert.equal(decideHasSigningRights({ instanceRole: 'manager', isApprover: false }), true)
      assert.equal(decideHasSigningRights({ instanceRole: 'admin', isApprover: false }), true)
      assert.equal(decideHasSigningRights({ instanceRole: 'auditor', isApprover: false }), false)
      assert.equal(decideHasSigningRights({ instanceRole: 'external', isApprover: false }), false)
      assert.equal(decideHasSigningRights({ instanceRole: null, isApprover: false }), false)
    })
  })

  describe('alarmsFromAccessSnapshots', () => {
    const base: Omit<AccessSnapshot, 'idpEnabled' | 'hasSigningRights'> = {
      principalId: 1,
      sub: 'alice',
      iss: 'https://idp.example',
      name: 'Alice',
    }

    it('alarms when IdP-disabled and has signing rights', () => {
      const alarms = alarmsFromAccessSnapshots([
        { ...base, idpEnabled: false, hasSigningRights: true },
      ])
      assert.equal(alarms.length, 1)
      assert.equal(alarms[0].sub, 'alice')
      assert.equal(alarms[0].severity, 'critical')
      assert.ok(alarms[0].reason.includes('disabled in IdP'))
    })

    it('skips when IdP-enabled, no signing rights, or IdP unavailable', () => {
      const alarms = alarmsFromAccessSnapshots([
        { ...base, principalId: 1, sub: 'a', idpEnabled: true, hasSigningRights: true },
        { ...base, principalId: 2, sub: 'b', idpEnabled: false, hasSigningRights: false },
        { ...base, principalId: 3, sub: 'c', idpEnabled: null, hasSigningRights: true },
      ])
      assert.equal(alarms.length, 0)
    })
  })

  describe('createPrincipalAccessMonitor', () => {
    it('loads snapshots through ports and classifies alarms', async () => {
      const monitor = createPrincipalAccessMonitor({
        listPrincipals: async () => [
          { id: 10, sub: 'disabled', iss: 'iss', name: 'Disabled' },
          { id: 11, sub: 'enabled', iss: 'iss', name: 'Enabled' },
          { id: 12, sub: 'nosign', iss: 'iss', name: 'NoSign' },
        ],
        idpEnabled: async (sub) => (sub === 'disabled' || sub === 'nosign' ? false : true),
        hasSigningRights: async (id) => id !== 12,
      })
      const alarms = await monitor.check()
      assert.equal(alarms.length, 1)
      assert.equal(alarms[0].sub, 'disabled')
      const run = await monitor.run()
      assert.equal(run.alarmsFound, 1)
    })

    it('resolves state through findPrincipal and the same snapshot ports', async () => {
      const monitor = createPrincipalAccessMonitor({
        findPrincipal: async (id) =>
          id === 7 ? { id: 7, sub: 'solo', iss: 'iss', name: 'Solo' } : null,
        idpEnabled: async () => false,
        hasSigningRights: async () => true,
      })
      const state = await monitor.state(7)
      assert.ok(state)
      assert.equal(state.sub, 'solo')
      assert.equal(state.idpEnabled, false)
      assert.equal(state.hasSigningRights, true)
      assert.equal(await monitor.state(99), null)
    })
  })

  describe('Disabled Principal Alarm', () => {
    it('detects disabled Principal with signing rights', async () => {
      const iss = 'http://localhost:8180/realms/mice'
      const sub = `disabled-user-${Date.now()}`
      setDirectoryFetchForTests(directoryFetch((url) => url.includes(`/users/${sub}`)))
      await getDb().insert(principals).values({
        sub,
        iss,
        createdAt: new Date(),
        name: 'Disabled User',
      })
      await grantSigningRole(sub, iss)

      const alarms = await checkDisabledPrincipalsWithSigningRights()
      const hit = alarms.find((a) => a.sub === sub)

      assert.ok(hit, 'Should detect one alarm')
      assert.equal(hit.severity, 'critical')
      assert.ok(hit.reason.includes('disabled in IdP'))
    })

    it('does not alarm for a disabled Principal without signing rights', async () => {
      const iss = 'http://localhost:8180/realms/mice'
      const sub = `disabled-pending-${Date.now()}`
      setDirectoryFetchForTests(directoryFetch((url) => url.includes(`/users/${sub}`)))
      await getDb().insert(principals).values({
        sub,
        iss,
        createdAt: new Date(),
        name: 'Disabled Pending',
      })
      // No instance role and no Approver seat → not a signer.
      const alarms = await checkDisabledPrincipalsWithSigningRights()
      assert.equal(alarms.some((a) => a.sub === sub), false)
    })

    it('does not alarm for enabled Principal', async () => {
      const iss = 'http://localhost:8180/realms/mice'
      const sub = `enabled-user-${Date.now()}`
      await getDb().insert(principals).values({
        sub,
        iss,
        createdAt: new Date(),
        name: 'Enabled User',
      })
      await grantSigningRole(sub, iss)

      const alarms = await checkDisabledPrincipalsWithSigningRights()

      assert.equal(alarms.some((a) => a.sub === sub), false, 'Should not alarm for enabled user')
    })

    it('detects multiple disabled Principals with signing rights', async () => {
      const iss = 'http://localhost:8180/realms/mice'
      const sub1 = `disabled-user-1-${Date.now()}`
      const sub2 = `disabled-user-2-${Date.now()}`
      await getDb().insert(principals).values([
        { sub: sub1, iss, createdAt: new Date(), name: 'Disabled User 1' },
        { sub: sub2, iss, createdAt: new Date(), name: 'Disabled User 2' },
      ])
      await grantSigningRole(sub1, iss)
      await grantSigningRole(sub2, iss)

      setDirectoryFetchForTests(
        directoryFetch((url) => url.includes(`/users/${sub1}`) || url.includes(`/users/${sub2}`)),
      )

      const alarms = await checkDisabledPrincipalsWithSigningRights()

      assert.equal(alarms.filter((a) => a.sub === sub1 || a.sub === sub2).length, 2)
    })

    it('handles IdP unavailable gracefully', async () => {
      const iss = 'http://localhost:8180/realms/mice'
      const sub = `test-user-${Date.now()}`
      await getDb().insert(principals).values({
        sub,
        iss,
        createdAt: new Date(),
        name: 'Test User',
      })
      await grantSigningRole(sub, iss)

      setDirectoryFetchForTests(async () => {
        throw new Error('IdP unavailable')
      })

      const alarms = await checkDisabledPrincipalsWithSigningRights()

      assert.equal(alarms.some((a) => a.sub === sub), false)
    })
  })

  describe('Principal Access State', () => {
    it('returns full access state for Principal', async () => {
      const iss = 'http://localhost:8180/realms/mice'
      const sub = `enabled-user-${Date.now()}`
      const [principal] = await getDb().insert(principals).values({
        sub,
        iss,
        createdAt: new Date(),
        name: 'Enabled User',
      }).returning()
      await grantSigningRole(sub, iss)

      const state = await getPrincipalAccessState(principal.id)

      assert.ok(state, 'Should return state')
      assert.equal(state.sub, sub)
      assert.equal(state.name, 'Enabled User')
      assert.equal(state.idpEnabled, true)
      assert.equal(state.hasSigningRights, true)
    })

    it('returns null for non-existent Principal', async () => {
      const state = await getPrincipalAccessState(999999)
      assert.equal(state, null)
    })

    it('detects disabled state without signing rights', async () => {
      const sub = `disabled-user-${Date.now()}`
      const [principal] = await getDb().insert(principals).values({
        sub,
        iss: 'http://localhost:8180/realms/mice',
        createdAt: new Date(),
        name: 'Disabled User',
      }).returning()
      setDirectoryFetchForTests(directoryFetch((url) => url.includes(`/users/${sub}`)))

      const state = await getPrincipalAccessState(principal.id)

      assert.ok(state, 'Should return state')
      assert.equal(state.idpEnabled, false, 'Should detect disabled status')
      assert.equal(state.hasSigningRights, false, 'Pending Principal has no signing rights')
    })
  })
})
