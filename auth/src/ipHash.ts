import { createHash, randomBytes } from 'node:crypto'
import { getDb } from './db/database.js'
import { ipHashSalt } from './db/schema.js'
import { eq } from 'drizzle-orm'

/**
 * Hashed IP Logging (Ticket 16, Round 8 U8)
 * 
 * Log source IPs as SHA-256(IP + daily_salt) for anomaly detection while
 * preserving privacy (GDPR minimization, Part 11 §11.300(d) device checks).
 * 
 * Daily salt rotation prevents long-term tracking. Same-day hashes enable
 * distributed attack detection (concurrent access from multiple locations).
 */

const nowDateUtc = () => new Date().toISOString().split('T')[0] // YYYY-MM-DD UTC

/**
 * Get or generate today's salt (UTC date).
 * Salt rotates at midnight UTC. Stored in database for persistence across restarts.
 */
export async function getDailySalt(): Promise<string> {
  const today = nowDateUtc()
  
  // Try to fetch today's salt from database
  const db = getDb()
  const [existing] = await db
    .select()
    .from(ipHashSalt)
    .where(eq(ipHashSalt.date, today))
    .limit(1)
  
  if (existing) {
    return existing.salt
  }
  
  // Generate new salt for today
  const newSalt = randomBytes(32).toString('hex') // 64 hex characters
  
  await db.insert(ipHashSalt).values({
    date: today,
    salt: newSalt,
    createdAt: new Date(),
  }).onConflictDoNothing() // Race condition: another process may have inserted
  
  // Fetch again to handle race
  const [inserted] = await db
    .select()
    .from(ipHashSalt)
    .where(eq(ipHashSalt.date, today))
    .limit(1)
  
  return inserted!.salt
}

/**
 * Hash an IP address with today's salt: SHA-256(IP + daily_salt).
 * Returns 64 hex characters, or null if IP is null/empty.
 */
export async function hashIp(ip: string | null | undefined): Promise<string | null> {
  if (!ip || ip.trim() === '') return null
  
  const salt = await getDailySalt()
  const hash = createHash('sha256')
    .update(ip + salt)
    .digest('hex')
  
  return hash
}

/**
 * Extract last 4 hex characters of hash for UI display (e.g., "...a3:7f").
 * Returns null if hash is null/empty.
 */
export function getDisplaySuffix(hash: string | null | undefined): string | null {
  if (!hash || hash.length < 4) return null
  return hash.slice(-4)
}

/**
 * Extract client IP from HTTP headers (X-Forwarded-For or X-Real-IP).
 * X-Forwarded-For takes precedence (proxy chain, first IP is client).
 * Returns null if no IP headers present.
 */
export function extractClientIp(headers: Headers): string | null {
  // X-Forwarded-For: client, proxy1, proxy2 (take first)
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0].trim()
    if (first) return first
  }
  
  // X-Real-IP: single IP
  const realIp = headers.get('x-real-ip')
  if (realIp) {
    return realIp.trim()
  }
  
  return null
}
