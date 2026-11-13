/**
 * Tests for seal key rotation (Ticket 17)
 */

import '../../db/testSchema.js'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { getDb } from '../../db/database.js'
import { sealKeys } from '../../db/schema.js'
import {
  getCurrentSealKey,
  getValidSealKeys,
  getSealKeyById,
  normalRotation,
  emergencyRotation,
  ensureBootstrapKey,
  isKeyValidForVerification,
  getAllSealKeys,
  rotateSealKeyWithAudit,
  presentSealKey,
} from './sealKeys.js'
import { queryAudit } from '../../audit.js'

const nowSec = () => Math.floor(Date.now() / 1000)

describe('Seal Key Rotation (Ticket 17)', () => {
  beforeEach(async () => {
    // Clean slate for each test
    await getDb().delete(sealKeys)
  })

  describe('Bootstrap Key', () => {
    it('creates a bootstrap key if none exists', async () => {
      const before = await getCurrentSealKey()
      assert.equal(before, null, 'No key should exist initially')
      
      await ensureBootstrapKey()
      
      const after = await getCurrentSealKey()
      assert.ok(after, 'Bootstrap key should be created')
      assert.ok(after.id.includes('seal_bootstrap_'), 'Key ID should include bootstrap marker')
      assert.equal(after.rotationType, 'normal')
      assert.equal(after.validUntil, null, 'Bootstrap key should be primary')
      assert.equal(after.revokedAt, null, 'Bootstrap key should not be revoked')
    })

    it('does not create a second bootstrap key if one exists', async () => {
      await ensureBootstrapKey()
      const first = await getCurrentSealKey()
      
      await ensureBootstrapKey()
      const second = await getCurrentSealKey()
      
      assert.equal(first!.id, second!.id, 'Should reuse existing key')
    })
  })

  describe('Normal Rotation', () => {
    it('creates a new key and sets 7-day expiry on old key', async () => {
      await ensureBootstrapKey()
      
      const oldKey = await getCurrentSealKey()
      assert.ok(oldKey, 'Should have a current key')
      
      const now = nowSec()
      const newKey = await normalRotation()
      
      assert.ok(newKey.id !== oldKey.id, 'New key should have different ID')
      assert.equal(newKey.rotationType, 'normal')
      assert.equal(newKey.validUntil, null, 'New key should be primary')
      assert.ok(newKey.validFrom >= now, 'New key valid from now')
      
      // Check old key was expired
      const updatedOldKey = await getSealKeyById(oldKey.id)
      assert.ok(updatedOldKey, 'Old key should still exist')
      assert.ok(updatedOldKey.validUntil, 'Old key should have expiry')
      
      const sevenDays = 7 * 24 * 60 * 60
      const expectedExpiry = now + sevenDays
      assert.ok(Math.abs(updatedOldKey.validUntil! - expectedExpiry) < 5, 'Old key expires in ~7 days')
    })

    it('new key becomes the current primary key', async () => {
      await ensureBootstrapKey()
      
      const newKey = await normalRotation()
      const currentKey = await getCurrentSealKey()
      
      assert.equal(currentKey!.id, newKey.id, 'New key should be current')
    })

    it('supports multiple rotations with overlap periods', async () => {
      await ensureBootstrapKey()
      
      const key1 = await getCurrentSealKey()
      const key2 = await normalRotation()
      const key3 = await normalRotation()
      
      // Key 3 is current
      const current = await getCurrentSealKey()
      assert.equal(current!.id, key3.id)
      
      // All three keys should be valid for verification (within their windows)
      const validKeys = await getValidSealKeys()
      assert.ok(validKeys.length >= 1, 'At least current key should be valid')
    })
  })

  describe('Emergency Rotation', () => {
    it('revokes current key with 8-hour grace period', async () => {
      await ensureBootstrapKey()
      
      const oldKey = await getCurrentSealKey()
      assert.ok(oldKey, 'Should have current key')
      
      const now = nowSec()
      const { oldKey: revokedKey, newKey } = await emergencyRotation()
      
      assert.equal(revokedKey.id, oldKey.id, 'Should revoke the current key')
      assert.ok(revokedKey.revokedAt, 'Old key should be revoked')
      assert.ok(revokedKey.revokedAt! >= now, 'Revocation time should be now')
      
      const eightHours = 8 * 60 * 60
      const expectedGraceEnd = now + eightHours
      assert.ok(Math.abs(revokedKey.validUntil! - expectedGraceEnd) < 5, 'Grace period is ~8 hours')
    })

    it('creates new key immediately', async () => {
      await ensureBootstrapKey()
      
      const now = nowSec()
      const { newKey } = await emergencyRotation()
      
      assert.ok(newKey.id.includes('seal_emerg_'), 'Emergency key ID should include marker')
      assert.equal(newKey.rotationType, 'emergency')
      assert.equal(newKey.validUntil, null, 'New key should be primary')
      assert.ok(newKey.validFrom >= now, 'New key valid immediately')
    })

    it('new key becomes current immediately', async () => {
      await ensureBootstrapKey()
      
      const { newKey } = await emergencyRotation()
      const currentKey = await getCurrentSealKey()
      
      assert.equal(currentKey!.id, newKey.id, 'New key should be current')
    })

    it('throws error if no current key exists', async () => {
      // No bootstrap key - table is clean from beforeEach
      await assert.rejects(
        async () => await emergencyRotation(),
        /No current seal key found/,
        'Should error when no key exists'
      )
    })

    it('uses an injected clock for revoke, grace, and new key validFrom', async () => {
      await ensureBootstrapKey()
      const at = 1_700_000_000
      const { oldKey, newKey } = await emergencyRotation(at)
      const eightHours = 8 * 60 * 60
      assert.equal(oldKey.revokedAt, at)
      assert.equal(oldKey.validUntil, at + eightHours)
      assert.equal(newKey.validFrom, at)
      const storedOld = await getSealKeyById(oldKey.id)
      assert.equal(storedOld!.revokedAt, at)
      assert.equal(storedOld!.validUntil, at + eightHours)
    })
  })

  describe('Key Verification', () => {
    it('accepts keys within their validity window', async () => {
      await ensureBootstrapKey()
      
      const key = await getCurrentSealKey()
      assert.ok(key, 'Should have key')
      
      const now = nowSec()
      assert.ok(isKeyValidForVerification(key, now), 'Current key should be valid')
    })

    it('rejects keys before validFrom', async () => {
      await ensureBootstrapKey()
      
      const key = await getCurrentSealKey()
      assert.ok(key, 'Should have key')
      
      const beforeValidFrom = key.validFrom - 10
      assert.ok(!isKeyValidForVerification(key, beforeValidFrom), 'Key should not be valid before validFrom')
    })

    it('accepts revoked keys within grace period', async () => {
      await ensureBootstrapKey()
      
      const { oldKey } = await emergencyRotation()
      
      // Right after revocation
      const afterRevocation = oldKey.revokedAt! + 60
      assert.ok(isKeyValidForVerification(oldKey, afterRevocation), 'Should be valid in grace period')
      
      // Just before grace period ends
      const beforeGraceEnd = oldKey.validUntil! - 60
      assert.ok(isKeyValidForVerification(oldKey, beforeGraceEnd), 'Should be valid near end of grace')
    })

    it('rejects revoked keys after grace period', async () => {
      await ensureBootstrapKey()
      
      const { oldKey } = await emergencyRotation()
      
      // After grace period
      const afterGrace = oldKey.validUntil! + 60
      assert.ok(!isKeyValidForVerification(oldKey, afterGrace), 'Should be invalid after grace period')
    })

    it('rejects keys after validUntil', async () => {
      await ensureBootstrapKey()
      
      await normalRotation()
      const keys = await getAllSealKeys()
      const expiredKey = keys.find(k => k.validUntil !== null)
      assert.ok(expiredKey, 'Should have an expired key')
      
      const afterExpiry = expiredKey.validUntil! + 60
      assert.ok(!isKeyValidForVerification(expiredKey, afterExpiry), 'Should be invalid after validUntil')
    })
  })

  describe('Key Retrieval', () => {
    it('getCurrentSealKey returns most recent non-revoked, non-expired key', async () => {
      await ensureBootstrapKey()
      
      const key1 = await getCurrentSealKey()
      await normalRotation()
      const key2 = await getCurrentSealKey()
      
      assert.ok(key2, 'Should have current key')
      assert.ok(key2.id !== key1!.id, 'Should be different key')
      assert.equal(key2.validUntil, null, 'Current key should have no expiry')
    })

    it('getValidSealKeys returns all keys within validity window', async () => {
      await ensureBootstrapKey()
      
      await normalRotation()
      
      const validKeys = await getValidSealKeys()
      assert.ok(validKeys.length >= 1, 'Should have at least one valid key')
      
      const now = nowSec()
      for (const key of validKeys) {
        assert.ok(isKeyValidForVerification(key, now), 'Each key should be valid')
      }
    })

    it('getValidSealKeys includes revoked keys in grace period', async () => {
      await ensureBootstrapKey()
      
      const { oldKey, newKey } = await emergencyRotation()
      
      const validKeys = await getValidSealKeys()
      const revokedKeyPresent = validKeys.some(k => k.id === oldKey.id)
      const newKeyPresent = validKeys.some(k => k.id === newKey.id)
      
      assert.ok(revokedKeyPresent, 'Revoked key should be in valid keys (grace period)')
      assert.ok(newKeyPresent, 'New key should be in valid keys')
    })

    it('getSealKeyById retrieves specific key', async () => {
      await ensureBootstrapKey()
      
      const currentKey = await getCurrentSealKey()
      assert.ok(currentKey, 'Should have current key')
      
      const retrieved = await getSealKeyById(currentKey.id)
      assert.ok(retrieved, 'Should retrieve key')
      assert.equal(retrieved.id, currentKey.id)
      assert.equal(retrieved.keyMaterial, currentKey.keyMaterial)
    })

    it('getSealKeyById returns null for non-existent key', async () => {
      const retrieved = await getSealKeyById('nonexistent')
      assert.equal(retrieved, null, 'Should return null for non-existent key')
    })
  })

  describe('Key Material', () => {
    it('generates unique key material for each key', async () => {
      await ensureBootstrapKey()
      
      const key1 = await getCurrentSealKey()
      await normalRotation()
      const key2 = await getCurrentSealKey()
      
      assert.ok(key1!.keyMaterial !== key2!.keyMaterial, 'Keys should have different material')
    })

    it('key material is base64-encoded', async () => {
      await ensureBootstrapKey()
      
      const key = await getCurrentSealKey()
      assert.ok(key, 'Should have key')
      
      // Base64 regex
      const base64Regex = /^[A-Za-z0-9+/]+=*$/
      assert.ok(base64Regex.test(key.keyMaterial), 'Key material should be valid base64')
      
      // Should decode to 32 bytes (AES-256-GCM)
      const decoded = Buffer.from(key.keyMaterial, 'base64')
      assert.equal(decoded.length, 32, 'Key material should be 32 bytes')
    })
  })

  describe('rotateSealKeyWithAudit', () => {
    const actor = {
      sub: 'admin',
      iss: 'https://idp.test',
      email: 'admin@test.io',
      name: 'Admin',
    }

    it('normal rotation audits seal_key.rotated', async () => {
      await ensureBootstrapKey()
      const result = await rotateSealKeyWithAudit({
        kind: 'normal',
        actor,
        via: 'session',
      })
      assert.equal(result.kind, 'normal')
      const { events } = await queryAudit({ action: 'seal_key.rotated', limit: 5 })
      assert.ok(events.some((e) => e.detail?.newKeyId === result.newKey.id))
    })

    it('presentSealKey omits key material and marks current', async () => {
      await ensureBootstrapKey()
      const key = await getCurrentSealKey()
      assert.ok(key)
      const view = presentSealKey(key)
      assert.equal(view.isCurrent, true)
      assert.equal(view.status, 'current')
      assert.equal('keyMaterial' in view, false)
    })
  })
})
