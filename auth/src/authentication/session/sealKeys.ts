/**
 * Session Seal Key Rotation (Ticket 17 - U7, U16)
 * 
 * Manages a key ring for session cookie encryption:
 * - Normal rotation: 30-day schedule with 7-day overlap
 * - Emergency rotation: Immediate revocation with 8-hour grace period
 * - Multiple active keys supported during overlap/grace periods
 * - Session verification accepts keys within valid window
 */

import { randomBytes } from 'node:crypto'
import { getDb } from '../../db/database.js'
import { sealKeys } from '../../db/schema.js'
import { eq, and, or, isNull, lte, gte, sql } from 'drizzle-orm'

const THIRTY_DAYS_SEC = 30 * 24 * 60 * 60
const SEVEN_DAYS_SEC = 7 * 24 * 60 * 60
const EIGHT_HOURS_SEC = 8 * 60 * 60

const nowSec = () => Math.floor(Date.now() / 1000)

export type SealKey = {
  id: string
  keyMaterial: string // Base64-encoded
  validFrom: number
  validUntil: number | null
  revokedAt: number | null
  rotationType: 'normal' | 'emergency'
  createdAt: Date
}

/**
 * Generate a new seal key with 32 bytes of entropy (AES-256-GCM).
 */
function generateKeyMaterial(): string {
  return randomBytes(32).toString('base64')
}

/**
 * Get the current primary seal key (most recent, not revoked, not expired).
 */
export async function getCurrentSealKey(): Promise<SealKey | null> {
  const now = nowSec()
  
  // Current primary key has validUntil = NULL and revokedAt = NULL
  // and validFrom <= now
  const [row] = await getDb()
    .select()
    .from(sealKeys)
    .where(
      and(
        lte(sealKeys.validFrom, now),
        isNull(sealKeys.validUntil),
        isNull(sealKeys.revokedAt)
      )
    )
    .orderBy(sql`${sealKeys.validFrom} DESC`)
    .limit(1)
  
  if (!row) return null
  
  return {
    id: row.id,
    keyMaterial: row.keyMaterial,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
    revokedAt: row.revokedAt,
    rotationType: row.rotationType as 'normal' | 'emergency',
    createdAt: row.createdAt,
  }
}

/**
 * Get all valid seal keys (for verification - includes keys in grace period).
 */
export async function getValidSealKeys(): Promise<SealKey[]> {
  const now = nowSec()
  
  const rows = await getDb()
    .select()
    .from(sealKeys)
    .where(
      and(
        lte(sealKeys.validFrom, now),
        or(
          isNull(sealKeys.validUntil),
          gte(sealKeys.validUntil, now)
        ),
        or(
          isNull(sealKeys.revokedAt),
          // Include revoked keys still in grace period
          gte(sealKeys.revokedAt, now - EIGHT_HOURS_SEC)
        )
      )
    )
    .orderBy(sql`${sealKeys.validFrom} DESC`)
  
  return rows.map(row => ({
    id: row.id,
    keyMaterial: row.keyMaterial,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
    revokedAt: row.revokedAt,
    rotationType: row.rotationType as 'normal' | 'emergency',
    createdAt: row.createdAt,
  }))
}

/**
 * Get a specific seal key by ID.
 */
export async function getSealKeyById(keyId: string): Promise<SealKey | null> {
  const [row] = await getDb()
    .select()
    .from(sealKeys)
    .where(eq(sealKeys.id, keyId))
    .limit(1)
  
  if (!row) return null
  
  return {
    id: row.id,
    keyMaterial: row.keyMaterial,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
    revokedAt: row.revokedAt,
    rotationType: row.rotationType as 'normal' | 'emergency',
    createdAt: row.createdAt,
  }
}

/**
 * Normal rotation: Create a new key, mark old key to expire in 7 days (overlap period).
 */
export async function normalRotation(): Promise<SealKey> {
  const now = nowSec()
  const keyId = `seal_${randomBytes(8).toString('hex')}`
  const keyMaterial = generateKeyMaterial()
  
  // Get current primary key
  const currentKey = await getCurrentSealKey()
  
  // If there's a current key, set its expiry to now + 7 days
  if (currentKey && !currentKey.validUntil) {
    await getDb()
      .update(sealKeys)
      .set({ validUntil: now + SEVEN_DAYS_SEC })
      .where(eq(sealKeys.id, currentKey.id))
  }
  
  // Create new key
  const [newKey] = await getDb()
    .insert(sealKeys)
    .values({
      id: keyId,
      keyMaterial,
      validFrom: now,
      validUntil: null, // Current primary key
      revokedAt: null,
      rotationType: 'normal',
      createdAt: new Date(),
    })
    .returning()
  
  return {
    id: newKey.id,
    keyMaterial: newKey.keyMaterial,
    validFrom: newKey.validFrom,
    validUntil: newKey.validUntil,
    revokedAt: newKey.revokedAt,
    rotationType: newKey.rotationType as 'normal',
    createdAt: newKey.createdAt,
  }
}

/**
 * Emergency rotation: Mark current key as revoked (8-hour grace period), issue new key.
 */
export async function emergencyRotation(): Promise<{ oldKey: SealKey; newKey: SealKey }> {
  const now = nowSec()
  const keyId = `seal_emerg_${randomBytes(8).toString('hex')}`
  const keyMaterial = generateKeyMaterial()
  
  // Get current primary key
  const currentKey = await getCurrentSealKey()
  if (!currentKey) {
    throw new Error('No current seal key found for emergency rotation')
  }
  
  // Mark current key as revoked with 8-hour grace period
  await getDb()
    .update(sealKeys)
    .set({
      revokedAt: now,
      validUntil: now + EIGHT_HOURS_SEC,
    })
    .where(eq(sealKeys.id, currentKey.id))
  
  // Create new key immediately
  const [newKey] = await getDb()
    .insert(sealKeys)
    .values({
      id: keyId,
      keyMaterial,
      validFrom: now,
      validUntil: null, // New primary key
      revokedAt: null,
      rotationType: 'emergency',
      createdAt: new Date(),
    })
    .returning()
  
  return {
    oldKey: {
      ...currentKey,
      revokedAt: now,
      validUntil: now + EIGHT_HOURS_SEC,
    },
    newKey: {
      id: newKey.id,
      keyMaterial: newKey.keyMaterial,
      validFrom: newKey.validFrom,
      validUntil: newKey.validUntil,
      revokedAt: newKey.revokedAt,
      rotationType: newKey.rotationType as 'emergency',
      createdAt: newKey.createdAt,
    },
  }
}

/**
 * Initialize the key ring with a bootstrap key if none exists.
 */
export async function ensureBootstrapKey(): Promise<void> {
  const existing = await getCurrentSealKey()
  if (existing) return
  
  const now = nowSec()
  const keyId = `seal_bootstrap_${randomBytes(8).toString('hex')}`
  const keyMaterial = generateKeyMaterial()
  
  await getDb()
    .insert(sealKeys)
    .values({
      id: keyId,
      keyMaterial,
      validFrom: now,
      validUntil: null,
      revokedAt: null,
      rotationType: 'normal',
      createdAt: new Date(),
    })
}

/**
 * Check if a key is valid for verification (within validity window and grace period).
 */
export function isKeyValidForVerification(key: SealKey, now = nowSec()): boolean {
  // Must be after validFrom
  if (now < key.validFrom) return false
  
  // If revoked, check grace period
  if (key.revokedAt !== null) {
    return now <= key.revokedAt + EIGHT_HOURS_SEC
  }
  
  // If has validUntil, check expiry
  if (key.validUntil !== null) {
    return now <= key.validUntil
  }
  
  // Current primary key (no validUntil, not revoked)
  return true
}

/**
 * Get all keys (for admin UI).
 */
export async function getAllSealKeys(): Promise<SealKey[]> {
  const rows = await getDb()
    .select()
    .from(sealKeys)
    .orderBy(sql`${sealKeys.validFrom} DESC`)
  
  return rows.map(row => ({
    id: row.id,
    keyMaterial: row.keyMaterial,
    validFrom: row.validFrom,
    validUntil: row.validUntil,
    revokedAt: row.revokedAt,
    rotationType: row.rotationType as 'normal' | 'emergency',
    createdAt: row.createdAt,
  }))
}
