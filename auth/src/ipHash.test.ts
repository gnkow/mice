import './db/testSchema.js'
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { overrideEnv } from './env.js'

/**
 * Hashed IP Logging Tests (Ticket 16)
 * 
 * Round 8 decision U8: Log source IPs as SHA-256(IP + daily_salt) for anomaly
 * detection while preserving privacy (GDPR minimization).
 * 
 * Daily salt rotation prevents long-term tracking. Same-day pattern detection
 * enables distributed attack detection without storing raw IPs.
 * 
 * Related:
 * - .scratch/authentication/issues/16-hashed-ip-logging.md
 * - Round 8 decision U8
 * - Part 11 §11.300(d) (device checks)
 */

describe('Hashed IP Logging (U8)', () => {
  it('generates daily salt on first call', async () => {
    const { getDailySalt } = await import('./ipHash.js')
    const salt = await getDailySalt()
    
    assert.ok(salt, 'Salt should be generated')
    assert.ok(salt.length >= 32, 'Salt should be at least 32 characters')
  })

  it('returns same salt for same day', async () => {
    const { getDailySalt } = await import('./ipHash.js')
    
    const salt1 = await getDailySalt()
    const salt2 = await getDailySalt()
    
    assert.equal(salt1, salt2, 'Salt should be consistent within same day')
  })

  it('hashes IP with daily salt', async () => {
    const { hashIp } = await import('./ipHash.js')
    
    const hash = await hashIp('192.168.1.100')
    
    assert.ok(hash, 'Hash should be generated')
    assert.ok(hash.length === 64, 'SHA-256 hash should be 64 hex characters')
  })

  it('same IP produces same hash on same day', async () => {
    const { hashIp } = await import('./ipHash.js')
    
    const hash1 = await hashIp('192.168.1.100')
    const hash2 = await hashIp('192.168.1.100')
    
    assert.equal(hash1, hash2, 'Same IP should hash to same value on same day')
  })

  it('different IPs produce different hashes', async () => {
    const { hashIp } = await import('./ipHash.js')
    
    const hash1 = await hashIp('192.168.1.100')
    const hash2 = await hashIp('192.168.1.101')
    
    assert.notEqual(hash1, hash2, 'Different IPs should produce different hashes')
  })

  it('extracts last 4 hex chars for UI display', async () => {
    const { hashIp, getDisplaySuffix } = await import('./ipHash.js')
    
    const hash = await hashIp('192.168.1.100')
    const suffix = getDisplaySuffix(hash)
    
    assert.ok(suffix, 'Display suffix should exist')
    assert.equal(suffix.length, 4, 'Display suffix should be 4 hex characters')
    assert.equal(suffix, hash.slice(-4), 'Suffix should be last 4 chars of hash')
  })

  it('handles IPv6 addresses', async () => {
    const { hashIp } = await import('./ipHash.js')
    
    const hash = await hashIp('2001:0db8:85a3:0000:0000:8a2e:0370:7334')
    
    assert.ok(hash, 'IPv6 should be hashable')
    assert.ok(hash.length === 64, 'IPv6 hash should be 64 hex characters')
  })

  it('handles null or empty IP gracefully', async () => {
    const { hashIp } = await import('./ipHash.js')
    
    const hash1 = await hashIp(null)
    const hash2 = await hashIp('')
    const hash3 = await hashIp(undefined)
    
    assert.ok(hash1 === null, 'Null IP should return null hash')
    assert.ok(hash2 === null, 'Empty IP should return null hash')
    assert.ok(hash3 === null, 'Undefined IP should return null hash')
  })

  it('extracts IP from X-Forwarded-For header', async () => {
    const { extractClientIp } = await import('./ipHash.js')
    
    const headers = new Headers()
    headers.set('x-forwarded-for', '203.0.113.195, 70.41.3.18, 150.172.238.178')
    
    const ip = extractClientIp(headers)
    assert.equal(ip, '203.0.113.195', 'Should extract first IP from X-Forwarded-For')
  })

  it('extracts IP from X-Real-IP header', async () => {
    const { extractClientIp } = await import('./ipHash.js')
    
    const headers = new Headers()
    headers.set('x-real-ip', '203.0.113.195')
    
    const ip = extractClientIp(headers)
    assert.equal(ip, '203.0.113.195', 'Should extract IP from X-Real-IP')
  })

  it('prefers X-Forwarded-For over X-Real-IP', async () => {
    const { extractClientIp } = await import('./ipHash.js')
    
    const headers = new Headers()
    headers.set('x-forwarded-for', '203.0.113.100')
    headers.set('x-real-ip', '203.0.113.200')
    
    const ip = extractClientIp(headers)
    assert.equal(ip, '203.0.113.100', 'X-Forwarded-For should take precedence')
  })

  it('returns null when no IP headers present', async () => {
    const { extractClientIp } = await import('./ipHash.js')
    
    const headers = new Headers()
    const ip = extractClientIp(headers)
    
    assert.equal(ip, null, 'Should return null when no IP headers')
  })
})
