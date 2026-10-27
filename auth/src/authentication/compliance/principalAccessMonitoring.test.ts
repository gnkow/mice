/**
 * Tests for Principal access monitoring (Ticket 11)
 */

import '../../db/testSchema.js'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { getDb } from '../../db/database.js'
import { principals } from '../../db/schema.js'
import { setDirectoryFetchForTests } from '../directory/directory.js'
import { checkDisabledPrincipalsWithSigningRights, getPrincipalAccessState } from './principalAccessMonitoring.js'

describe('Principal Access Monitoring (Ticket 11)', () => {
  beforeEach(async () => {
    // Clean slate
    await getDb().delete(principals)
    
    // Set up mock directory
    setDirectoryFetchForTests(async (url) => {
      // Mock directory responses
      if (url.includes('/users/disabled-user')) {
        return new Response(JSON.stringify({ enabled: false }), { status: 200 })
      }
      if (url.includes('/users/enabled-user')) {
        return new Response(JSON.stringify({ enabled: true }), { status: 200 })
      }
      return new Response(JSON.stringify({ enabled: true }), { status: 200 })
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
      setDirectoryFetchForTests(async (url) => {
        if (url.includes('/users/disabled-user')) {
          return new Response(JSON.stringify({ enabled: false }), { status: 200 })
        }
        return new Response(JSON.stringify({ enabled: true }), { status: 200 })
      })

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
