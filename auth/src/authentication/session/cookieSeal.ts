/**
 * Cookie Sealing with Key Ring (Ticket 03, Ticket 17)
 * 
 * Encrypts session cookies with AES-256-GCM using the seal key ring.
 * - Seal: encrypt with current primary key
 * - Unseal: try all valid keys (supports rotation without logout)
 * - Format: keyId.iv.ciphertext.authTag (all base64url)
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { getCurrentSealKey, getValidSealKeys, type SealKey } from './sealKeys.js'

const ALGORITHM = 'aes-256-gcm'

/**
 * Sealed cookie format: keyId.iv.ciphertext.authTag
 * All parts are base64url encoded for cookie safety.
 */
type SealedCookie = {
  keyId: string
  iv: Buffer
  ciphertext: Buffer
  authTag: Buffer
}

/**
 * Serialize a sealed cookie to a string.
 */
function serialize(sealed: SealedCookie): string {
  return [
    sealed.keyId,
    sealed.iv.toString('base64url'),
    sealed.ciphertext.toString('base64url'),
    sealed.authTag.toString('base64url'),
  ].join('.')
}

/**
 * Deserialize a sealed cookie string.
 */
function deserialize(cookieValue: string): SealedCookie | null {
  const parts = cookieValue.split('.')
  if (parts.length !== 4) return null
  
  const [keyId, ivB64, ciphertextB64, authTagB64] = parts
  
  try {
    return {
      keyId,
      iv: Buffer.from(ivB64, 'base64url'),
      ciphertext: Buffer.from(ciphertextB64, 'base64url'),
      authTag: Buffer.from(authTagB64, 'base64url'),
    }
  } catch {
    return null
  }
}

/**
 * Encrypt a session ID with the current seal key.
 * Returns a sealed cookie string: keyId.iv.ciphertext.authTag
 */
export async function sealSessionCookie(sessionId: string): Promise<string> {
  const key = await getCurrentSealKey()
  if (!key) {
    throw new Error('No current seal key available')
  }
  
  const keyBuffer = Buffer.from(key.keyMaterial, 'base64')
  const iv = randomBytes(12) // GCM standard IV size
  const plaintext = Buffer.from(sessionId, 'utf8')
  
  const cipher = createCipheriv(ALGORITHM, keyBuffer, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const authTag = cipher.getAuthTag()
  
  return serialize({
    keyId: key.id,
    iv,
    ciphertext,
    authTag,
  })
}

/**
 * Decrypt a sealed cookie with any valid key in the ring.
 * Returns the original session ID, or null if decryption fails.
 */
export async function unsealSessionCookie(sealedCookie: string): Promise<string | null> {
  const sealed = deserialize(sealedCookie)
  if (!sealed) return null
  
  // Get all valid keys (includes keys in overlap/grace periods)
  const keys = await getValidSealKeys()
  
  // Try each key, starting with the one that sealed it
  const keyOrder = [
    keys.find(k => k.id === sealed.keyId),
    ...keys.filter(k => k.id !== sealed.keyId),
  ].filter((k): k is SealKey => k !== undefined)
  
  for (const key of keyOrder) {
    try {
      const keyBuffer = Buffer.from(key.keyMaterial, 'base64')
      const decipher = createDecipheriv(ALGORITHM, keyBuffer, sealed.iv)
      decipher.setAuthTag(sealed.authTag)
      
      const plaintext = Buffer.concat([
        decipher.update(sealed.ciphertext),
        decipher.final(),
      ])
      
      return plaintext.toString('utf8')
    } catch {
      // Wrong key or tampered cookie - try next key
      continue
    }
  }
  
  // No key could decrypt the cookie
  return null
}
