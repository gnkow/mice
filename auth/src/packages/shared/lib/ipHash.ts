import { createHash, randomBytes } from 'node:crypto'
import { getDb } from '../../../db/database.js'
import { ipHashSalt } from '../../../db/schema.js'
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

export type IpHashDeps = {
  /** UTC calendar day key (YYYY-MM-DD). Injectable so salt rotation is testable. */
  utcDay?: () => string
}

/** Store hash + 4-hex UI suffix for one request fingerprint. */
export type IpFingerprint = { hash: string; suffix: string }

export type IpHash = {
  getDailySalt(): Promise<string>
  hashIp(ip: string | null | undefined): Promise<string | null>
  /** Extract client IP from request headers, then hash with today's salt. */
  hashFromHeaders(headers: Headers): Promise<string | null>
  /**
   * Fingerprint for device start: headers and optional TCP peer.
   * Null when no client IP can be resolved (start must reject).
   */
  fingerprintFromRequest(
    headers: Headers,
    peerAddress?: string | null,
  ): Promise<IpFingerprint | null>
  /** @deprecated Prefer fingerprintFromRequest — headers only, no peer fallback. */
  fingerprintFromHeaders(headers: Headers): Promise<IpFingerprint | null>
  displaySuffix(hash: string | null | undefined): string | null
}

/** Pure SHA-256(IP + salt) — formula seam with no DB / day clock. */
export function computeIpHash(ip: string, salt: string): string {
  return createHash('sha256').update(ip + salt).digest('hex')
}

const defaultUtcDay = () => new Date().toISOString().split('T')[0]! // YYYY-MM-DD UTC

/** Strip IPv4-mapped IPv6 prefix so hashes stay stable for the same host. */
export function normalizeClientIp(ip: string): string {
  const trimmed = ip.trim()
  if (trimmed.startsWith('::ffff:')) return trimmed.slice('::ffff:'.length)
  return trimmed
}

/**
 * Extract client IP from HTTP headers (X-Forwarded-For, CF-Connecting-IP, or X-Real-IP).
 * X-Forwarded-For takes precedence (proxy chain, first IP is client).
 * Returns null if no IP headers present.
 */
export function extractClientIp(headers: Headers): string | null {
  // X-Forwarded-For: client, proxy1, proxy2 (take first)
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return normalizeClientIp(first)
  }

  const cfIp = headers.get('cf-connecting-ip')
  if (cfIp?.trim()) return normalizeClientIp(cfIp)

  // X-Real-IP: single IP
  const realIp = headers.get('x-real-ip')
  if (realIp?.trim()) return normalizeClientIp(realIp)

  return null
}

/**
 * Resolve the client IP for fingerprinting: proxy headers first, then TCP peer.
 * Returns null when neither is available (caller should reject).
 */
export function resolveClientIp(
  headers: Headers,
  peerAddress?: string | null,
): string | null {
  const fromHeaders = extractClientIp(headers)
  if (fromHeaders) return fromHeaders
  if (peerAddress?.trim()) return normalizeClientIp(peerAddress)
  return null
}

/**
 * Deep hashed-IP module: daily salt rotation, SHA-256(IP + salt), header extract,
 * fingerprint (hash + suffix), and the 4-hex display suffix — one small interface
 * for device-approval callers.
 */
export function createIpHash(deps: IpHashDeps = {}): IpHash {
  const utcDay = deps.utcDay ?? defaultUtcDay

  async function getDailySalt(): Promise<string> {
    const today = utcDay()
    const db = getDb()
    const [existing] = await db
      .select()
      .from(ipHashSalt)
      .where(eq(ipHashSalt.date, today))
      .limit(1)

    if (existing) {
      return existing.salt
    }

    const newSalt = randomBytes(32).toString('hex')

    await db.insert(ipHashSalt).values({
      date: today,
      salt: newSalt,
      createdAt: new Date(),
    }).onConflictDoNothing()

    const [inserted] = await db
      .select()
      .from(ipHashSalt)
      .where(eq(ipHashSalt.date, today))
      .limit(1)

    return inserted!.salt
  }

  async function hashIp(ip: string | null | undefined): Promise<string | null> {
    if (!ip || ip.trim() === '') return null

    const salt = await getDailySalt()
    return computeIpHash(ip, salt)
  }

  async function hashFromHeaders(headers: Headers): Promise<string | null> {
    return hashIp(extractClientIp(headers))
  }

  function displaySuffix(hash: string | null | undefined): string | null {
    if (!hash || hash.length < 4) return null
    return hash.slice(-4)
  }

  async function fingerprintFromRequest(
    headers: Headers,
    peerAddress?: string | null,
  ): Promise<IpFingerprint | null> {
    const ip = resolveClientIp(headers, peerAddress)
    const hash = await hashIp(ip)
    if (!hash) return null
    const suffix = displaySuffix(hash)
    if (!suffix) return null
    return { hash, suffix }
  }

  async function fingerprintFromHeaders(headers: Headers): Promise<IpFingerprint | null> {
    return fingerprintFromRequest(headers)
  }

  return {
    getDailySalt,
    hashIp,
    hashFromHeaders,
    fingerprintFromRequest,
    fingerprintFromHeaders,
    displaySuffix,
  }
}

const live = createIpHash()

export const getDailySalt = live.getDailySalt
export const hashIp = live.hashIp
export const hashFromHeaders = live.hashFromHeaders
export const fingerprintFromHeaders = live.fingerprintFromHeaders
export const fingerprintFromRequest = live.fingerprintFromRequest
export const getDisplaySuffix = live.displaySuffix
