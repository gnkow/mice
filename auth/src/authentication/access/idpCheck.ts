/**
 * Live IdP status checking for access control.
 * 
 * Ticket #19 (U3): Removed all cache tolerance for IdP availability.
 * Every authenticated operation requires a live IdP check.
 * IdP unreachable = 503 for all requests (including reads).
 * 
 * Rules:
 * - IdP is checked on every authenticated request (login, refresh, all API calls)
 * - If IdP is unreachable, deny access with 503 (no cache fallback, no grace period)
 * - If user is disabled in IdP, deny access immediately
 * - Groups checked at: login, refresh, privileged operations
 * - Ordinary reads use session-cached groups (bounded by 8h session lifetime)
 */

import type { SessionUser } from '../session/session.js'
import { lookupKeycloakUserStatus, type DirectoryUserStatus } from '../directory/directory.js'

/**
 * Checks the user's status with the IdP.
 * 
 * @param user - The session user
 * @returns The IdP status
 * @throws Error if IdP is unreachable (error status)
 */
export async function checkUserIdpStatus(user: SessionUser): Promise<DirectoryUserStatus> {
  const status = await lookupKeycloakUserStatus(user.sub)
  
  // If IdP returned 'error', it means the directory is unreachable
  if (status === 'error') {
    throw new Error('IdP is unreachable - cannot verify user status')
  }
  
  return status
}

/**
 * Verifies that a user is enabled in the IdP.
 * Always performs a live check (no throttling).
 * 
 * @param user - The session user
 * @returns true if user is enabled, false if disabled/missing/unreachable
 */
export async function verifyIdpAccess(user: SessionUser): Promise<boolean> {
  try {
    const status = await checkUserIdpStatus(user)
    
    // User must be enabled
    return status === 'enabled'
  } catch (error) {
    // IdP unreachable - deny access (no cache fallback)
    return false
  }
}
