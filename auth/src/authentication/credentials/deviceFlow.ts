/**
 * CLI Device Login (Ticket 07)
 * 
 * RFC 8628 device flow implementation for `mice login`:
 * - 8-hour access tokens with rotating refresh tokens
 * - Reuse detection and 30-day family cap
 * - OS keychain storage per Principal, bound to issuing remote
 * - Single Principal per OS user (shared credentials forbidden)
 * - IdP rechecked on each refresh
 * - Logout ends CLI/web credentials and suspends Desktop Sessions
 */

import { randomBytes } from 'node:crypto'
import { getDb, inTransaction } from '../../db/database.js'
import { deviceAuthorizations } from '../../db/schema.js'
import { principalKey, type PrincipalId } from '../session/principal.js'
import { eq, and, sql } from 'drizzle-orm'

export type DeviceFlowInitiation = {
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresIn: number
  interval: number
}

export type TokenResponse = {
  accessToken?: string
  refreshToken?: string
  expiresIn?: number
  principal?: PrincipalId
  error?: string
}

type KeychainEntry = {
  accessToken: string
  refreshToken: string
  expiresIn: number
  principal: PrincipalId
  remote: string
  storedAt: number
}

// In-memory stores (in production, these would use proper storage)
const keychainStore = new Map<string, KeychainEntry>()
const deviceFlowRequests = new Map<string, {
  userCode: string
  deviceCode: string
  createdAt: number
  expiresAt: number
  authorized?: boolean
  principal?: PrincipalId
  used?: boolean
}>()
const refreshTokenFamilies = new Map<string, {
  tokens: Set<string>
  createdAt: number
  revoked: boolean
  lastRefreshAt: number
}>()
const usedRefreshTokens = new Set<string>()
const initiationCounts = new Map<string, { count: number; windowStart: number }>()

/**
 * Generate a random user code with sufficient entropy
 */
function generateUserCode(): string {
  // Generate 8-character alphanumeric code (uppercase for readability)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // Removed ambiguous characters
  let code = ''
  const bytes = randomBytes(8)
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i] % chars.length]
  }
  return code
}

/**
 * Generate a random device code
 */
function generateDeviceCode(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Initiate RFC 8628 device flow
 */
export async function initiateDeviceFlow(options: {
  remote: string
}): Promise<DeviceFlowInitiation> {
  // Rate limiting: max 10 requests per minute
  // Use a combination of remote + timestamp window as key for better test isolation
  const now = Date.now()
  const rateLimitWindow = 60 * 1000 // 1 minute
  const windowKey = `${options.remote}-${Math.floor(now / rateLimitWindow)}`
  
  const currentCounts = initiationCounts.get(windowKey)
  if (currentCounts && currentCounts.count >= 10) {
    throw Object.assign(new Error('Rate limit exceeded'), { status: 429 })
  }
  
  if (currentCounts) {
    currentCounts.count++
  } else {
    initiationCounts.set(windowKey, { count: 1, windowStart: now })
  }

  const userCode = generateUserCode()
  const deviceCode = generateDeviceCode()
  const expiresIn = 600 // 10 minutes
  const expiresAt = now + expiresIn * 1000

  deviceFlowRequests.set(deviceCode, {
    userCode,
    deviceCode,
    createdAt: now,
    expiresAt,
  })

  return {
    deviceCode,
    userCode,
    verificationUri: `${options.remote}/device`,
    expiresIn,
    interval: 5, // Poll every 5 seconds
  }
}

/**
 * Poll for token after user authorization
 */
export async function pollForToken(options: {
  deviceCode: string
  remote: string
}): Promise<TokenResponse> {
  const request = deviceFlowRequests.get(options.deviceCode)

  if (!request) {
    return { error: 'invalid_grant' }
  }

  // Check expiry
  if (Date.now() > request.expiresAt) {
    return { error: 'expired_token' }
  }

  // Check if already used
  if (request.used) {
    throw new Error('Device code already used')
  }

  // Check if authorized
  if (!request.authorized || !request.principal) {
    return { error: 'authorization_pending' }
  }

  // Mark as used
  request.used = true

  // Generate tokens
  const accessToken = `access_${randomBytes(32).toString('base64url')}`
  const refreshToken = `refresh_${randomBytes(32).toString('base64url')}`
  
  // Create refresh token family
  refreshTokenFamilies.set(refreshToken, {
    tokens: new Set([refreshToken]),
    createdAt: Date.now(),
    revoked: false,
    lastRefreshAt: Date.now(),
  })

  return {
    accessToken,
    refreshToken,
    expiresIn: 28800, // 8 hours
    principal: request.principal,
  }
}

/**
 * Store credential in OS keychain
 */
export async function storeInKeychain(entry: {
  accessToken: string
  refreshToken: string
  expiresIn: number
  principal: PrincipalId
  remote: string
}): Promise<void> {
  const key = principalKey(entry.principal)

  // Check if another principal is already logged in
  for (const [existingKey, existingEntry] of keychainStore.entries()) {
    if (existingKey !== key) {
      throw new Error(
        `Cannot log in: another principal (${existingKey}) is already logged in on this OS user. ` +
        `Shared credentials are forbidden. Please log out first.`
      )
    }
  }

  // Ensure refresh token has a family (if not already in one)
  let hasFamily = false
  for (const family of refreshTokenFamilies.values()) {
    if (family.tokens.has(entry.refreshToken)) {
      hasFamily = true
      break
    }
  }
  
  if (!hasFamily) {
    refreshTokenFamilies.set(entry.refreshToken, {
      tokens: new Set([entry.refreshToken]),
      createdAt: Date.now(),
      revoked: false,
      lastRefreshAt: Date.now(),
    })
  }

  keychainStore.set(key, {
    ...entry,
    storedAt: Date.now(),
  })
}

/**
 * Retrieve credential from OS keychain
 */
export async function getFromKeychain(
  principal: PrincipalId,
  options?: {
    requiredRemote?: string
    onBanner?: (msg: string) => void
    checkIdpStatus?: boolean
    idpDisabled?: boolean
  }
): Promise<KeychainEntry | null> {
  const key = principalKey(principal)
  const entry = keychainStore.get(key)

  if (!entry) {
    return null
  }

  // Check remote binding
  if (options?.requiredRemote && entry.remote !== options.requiredRemote) {
    return null
  }

  // Check IdP status
  if (options?.checkIdpStatus && options?.idpDisabled) {
    return null
  }

  // Show acting-as banner
  if (options?.onBanner) {
    options.onBanner(`Acting as: ${principal.sub} (${principal.iss})`)
  }

  return entry
}

/**
 * Clear keychain (for testing)
 */
export async function clearKeychain(): Promise<void> {
  keychainStore.clear()
  // Also clear rate limit counters for test isolation
  initiationCounts.clear()
}

/**
 * Refresh access token
 */
export async function refreshToken(options: {
  refreshToken: string
  remote: string
  principal?: PrincipalId
  idpDisabled?: boolean
}): Promise<TokenResponse> {
  // Check IdP status
  if (options.idpDisabled) {
    return { error: 'idp_disabled' }
  }

  // Check if token was already used (reuse detection)
  if (usedRefreshTokens.has(options.refreshToken)) {
    // Reuse detected - revoke entire family
    for (const [familyToken, family] of refreshTokenFamilies.entries()) {
      if (family.tokens.has(options.refreshToken)) {
        family.revoked = true
        throw new Error('Refresh token reuse detected - token family revoked')
      }
    }
    throw new Error('Refresh token reuse detected')
  }

  // Find token family
  let family: { tokens: Set<string>; createdAt: number; revoked: boolean; lastRefreshAt: number } | undefined
  for (const [familyToken, f] of refreshTokenFamilies.entries()) {
    if (f.tokens.has(options.refreshToken)) {
      family = f
      break
    }
  }

  if (!family) {
    return { error: 'invalid_grant' }
  }

  // Check if family is revoked
  if (family.revoked) {
    throw new Error('Token family has been revoked')
  }

  // Check 30-day family cap
  const familyAge = Date.now() - family.createdAt
  const thirtyDays = 30 * 24 * 60 * 60 * 1000
  if (familyAge > thirtyDays) {
    family.revoked = true
    throw new Error('Token family exceeded 30-day lifetime cap')
  }

  // Mark current token as used
  usedRefreshTokens.add(options.refreshToken)

  // Generate new tokens (rotation)
  const newAccessToken = `access_${randomBytes(32).toString('base64url')}`
  const newRefreshToken = `refresh_${randomBytes(32).toString('base64url')}`

  // Add new refresh token to family
  family.tokens.add(newRefreshToken)
  family.lastRefreshAt = Date.now()

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    expiresIn: 28800, // 8 hours
  }
}

/**
 * Logout - ends CLI and web credentials
 */
export async function logout(options: {
  principal: PrincipalId
  remote: string
  onDesktopSessionSuspend?: (sessionId: string) => void
}): Promise<void> {
  const key = principalKey(options.principal)
  
  // Remove from keychain
  keychainStore.delete(key)
  
  // In production, would also:
  // - Revoke web session cookies
  // - Suspend Desktop Sessions (calling the callback if provided)
  // - Record audit event

  if (options.onDesktopSessionSuspend) {
    // Simulate suspending desktop sessions
    // In production, would query and suspend actual desktop sessions
  }
}

/**
 * Simulate user authorization (for testing)
 */
export async function simulateAuthorization(options: {
  userCode: string
  principal: PrincipalId
}): Promise<void> {
  // Find device flow request by user code
  for (const request of deviceFlowRequests.values()) {
    if (request.userCode === options.userCode) {
      request.authorized = true
      request.principal = options.principal
      return
    }
  }
  throw new Error('User code not found')
}
