/**
 * Tests for cookie sealing with key ring rotation (Ticket 03, Ticket 17)
 */

import '../../db/testSchema.js'
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isolatedAuth } from '../../testSupport.js'

const ctx = isolatedAuth()
after(() => ctx.restore())

const { sealSessionCookie, unsealSessionCookie } = await import('./cookieSeal.js')
const { normalRotation, emergencyRotation, ensureBootstrapKey } = await import('./sealKeys.js')
const { getDb } = await import('../../db/database.js')
const { sealKeys } = await import('../../db/schema.js')

describe('Cookie Sealing with Key Ring', async () => {
  // Clean up and bootstrap key before each test
  const beforeTest = async () => {
    await getDb().delete(sealKeys)
    await ensureBootstrapKey()
  }

  it('seals and unseals a session cookie', async () => {
    await beforeTest()
    const sessionId = 'test-session-id-12345'
    
    const sealed = await sealSessionCookie(sessionId)
    assert.ok(sealed)
    assert.strictEqual(sealed.split('.').length, 4) // keyId.iv.ciphertext.authTag
    
    const unsealed = await unsealSessionCookie(sealed)
    assert.strictEqual(unsealed, sessionId)
  })

  it('rejects tampered cookies', async () => {
    await beforeTest()
    const sessionId = 'test-session-id-12345'
    const sealed = await sealSessionCookie(sessionId)
    
    // Tamper with the cookie
    const parts = sealed.split('.')
    parts[2] = parts[2].slice(0, -1) + 'X' // Change last char of ciphertext
    const tampered = parts.join('.')
    
    const unsealed = await unsealSessionCookie(tampered)
    assert.strictEqual(unsealed, null)
  })

  it('unseals cookies after normal rotation (7-day overlap)', async () => {
    await beforeTest()
    const sessionId = 'test-session-id-12345'
    
    // Seal with initial key
    const sealed1 = await sealSessionCookie(sessionId)
    
    // Perform normal rotation (creates new key, old key valid for 7 days)
    await normalRotation()
    
    // Old cookie should still work (within 7-day overlap)
    const unsealed1 = await unsealSessionCookie(sealed1)
    assert.strictEqual(unsealed1, sessionId)
    
    // New cookies use new key
    const sealed2 = await sealSessionCookie(sessionId)
    const unsealed2 = await unsealSessionCookie(sealed2)
    assert.strictEqual(unsealed2, sessionId)
    
    // Both cookies should work simultaneously
    assert.strictEqual(await unsealSessionCookie(sealed1), sessionId)
    assert.strictEqual(await unsealSessionCookie(sealed2), sessionId)
  })

  it('unseals cookies after emergency rotation (8-hour grace)', async () => {
    await beforeTest()
    const sessionId = 'test-session-id-12345'
    
    // Seal with initial key
    const sealed1 = await sealSessionCookie(sessionId)
    
    // Perform emergency rotation (revokes old key with 8-hour grace)
    await emergencyRotation()
    
    // Old cookie should still work (within 8-hour grace period)
    const unsealed1 = await unsealSessionCookie(sealed1)
    assert.strictEqual(unsealed1, sessionId)
    
    // New cookies use new key
    const sealed2 = await sealSessionCookie(sessionId)
    const unsealed2 = await unsealSessionCookie(sealed2)
    assert.strictEqual(unsealed2, sessionId)
  })

  it('rejects cookies with unknown key ID', async () => {
    await beforeTest()
    const fakeSealed = 'unknown-key-id.aGVsbG8.d29ybGQ.YXV0aA'
    const unsealed = await unsealSessionCookie(fakeSealed)
    assert.strictEqual(unsealed, null)
  })

  it('rejects malformed cookie format', async () => {
    await beforeTest()
    const malformed = 'not.enough.parts'
    const unsealed = await unsealSessionCookie(malformed)
    assert.strictEqual(unsealed, null)
  })

  it('handles multiple rotations', async () => {
    await beforeTest()
    const sessionId = 'test-session-id-12345'
    
    // Create cookies with different keys
    const sealed1 = await sealSessionCookie(sessionId)
    
    await normalRotation()
    const sealed2 = await sealSessionCookie(sessionId)
    
    await normalRotation()
    const sealed3 = await sealSessionCookie(sessionId)
    
    // All cookies should still be valid (within overlap periods)
    assert.strictEqual(await unsealSessionCookie(sealed1), sessionId)
    assert.strictEqual(await unsealSessionCookie(sealed2), sessionId)
    assert.strictEqual(await unsealSessionCookie(sealed3), sessionId)
  })
})
