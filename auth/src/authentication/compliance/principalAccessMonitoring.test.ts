/**
 * Tests for Principal access monitoring (Ticket 11)
 */

import '../../db/testSchema.js'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { getDb } from '../../db/database.js'
import { principals } from '../../db/schema.js'
import { setDirectoryFetchForTests } from '../directory/directory.js'
import { overrideEnv } from '../../env.js'
import {
  alarmsFromAccessSnapshots,
  checkDisabledPrincipalsWithSigningRights,
  createPrincipalAccessMonitor,
  getPrincipalAccessState,
  type AccessSnapshot,
} from './principalAccessMonitoring.js'

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
    await getDb().delete(principals)
    overrideEnv({
      directoryProvider: 'keycloak',
      keycloakAdminUrl: 'http://directory.test',
      keycloakRealm: 'mice',
      oidcClientId: 'mice-auth',
      oidcClientSecret: 'test-secret',
    })
    setDirectoryFetchForTests(directoryFetch((url) => url.includes('/users/disabled-user')))
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
  })

  describe('Disabled Principal Alarm', () => {
    it('detects disabled Principal with signing rights', async () => {
      // Create a disabled Principal
      await getDb().insert(principals).values({
        sub: 'disabled-user',
        iss: 'http://localhost:8180/realms/mice',
        createdAt: new Date(),
        name: 'Disabled User',
      })

      const alarms = await checkDisabledPrincipalsWithSigningRights()

      assert.equal(alarms.length, 1, 'Should detect one alarm')
      assert.equal(alarms[0].sub, 'disabled-user')
      assert.equal(alarms[0].severity, 'critical')
      assert.ok(alarms[0].reason.includes('disabled in IdP'))
    })

    it('does not alarm for enabled Principal', async () => {
      // Create an enabled Principal
      await getDb().insert(principals).values({
        sub: 'enabled-user',
        iss: 'http://localhost:8180/realms/mice',
        createdAt: new Date(),
        name: 'Enabled User',
      })

      const alarms = await checkDisabledPrincipalsWithSigningRights()

      assert.equal(alarms.length, 0, 'Should not alarm for enabled user')
    })

    it('detects multiple disabled Principals', async () => {
      // Create multiple disabled Principals
      await getDb().insert(principals).values([
        {
          sub: 'disabled-user-1',
          iss: 'http://localhost:8180/realms/mice',
          createdAt: new Date(),
          name: 'Disabled User 1',
        },
        {
          sub: 'disabled-user-2',
          iss: 'http://localhost:8180/realms/mice',
          createdAt: new Date(),
          name: 'Disabled User 2',
        },
      ])

      // Update mock to return disabled for both
      setDirectoryFetchForTests(directoryFetch((url) => url.includes('/users/disabled-user')))

      const alarms = await checkDisabledPrincipalsWithSigningRights()

      assert.equal(alarms.length, 2, 'Should detect both disabled users')
    })

    it('handles IdP unavailable gracefully', async () => {
      await getDb().insert(principals).values({
        sub: 'test-user',
        iss: 'http://localhost:8180/realms/mice',
        createdAt: new Date(),
        name: 'Test User',
      })

      // Mock IdP unavailable
      setDirectoryFetchForTests(async () => {
        throw new Error('IdP unavailable')
      })

      const alarms = await checkDisabledPrincipalsWithSigningRights()

      // Should not alarm when IdP is unavailable (can't verify)
      assert.equal(alarms.length, 0, 'Should handle IdP unavailable gracefully')
    })
  })

  describe('Principal Access State', () => {
    it('returns full access state for Principal', async () => {
      const [principal] = await getDb().insert(principals).values({
        sub: 'enabled-user',
        iss: 'http://localhost:8180/realms/mice',
        createdAt: new Date(),
        name: 'Enabled User',
      }).returning()

      const state = await getPrincipalAccessState(principal.id)

      assert.ok(state, 'Should return state')
      assert.equal(state.sub, 'enabled-user')
      assert.equal(state.name, 'Enabled User')
      assert.equal(state.idpEnabled, true)
      assert.equal(state.hasSigningRights, true)
    })

    it('returns null for non-existent Principal', async () => {
      const state = await getPrincipalAccessState(999999)
      assert.equal(state, null)
    })

    it('detects disabled state', async () => {
      const [principal] = await getDb().insert(principals).values({
        sub: 'disabled-user',
        iss: 'http://localhost:8180/realms/mice',
        createdAt: new Date(),
        name: 'Disabled User',
      }).returning()

      const state = await getPrincipalAccessState(principal.id)

      assert.ok(state, 'Should return state')
      assert.equal(state.idpEnabled, false, 'Should detect disabled status')
    })
  })
})
