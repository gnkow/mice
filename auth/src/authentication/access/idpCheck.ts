/**
 * Live IdP status checking for access control.
 * 
 * Rules:
 * - IdP is checked at login, refresh, signing, privileged mutations
 * - For ordinary requests, check at most every 5 minutes
 * - If IdP is unreachable, deny access (no cache fallback)
 * - If user is disabled in IdP, deny access immediately
 */

import type { SessionUser } from '../session/session.js'
import { lookupKeycloakUserStatus, type DirectoryUserStatus } from '../directory/directory.js'

const FIVE_MINUTES = 5 * 60 // seconds

/**
 * Determines if we need to check IdP status for this user.
 * 
 * @param user - The session user
 * @param forceFresh - Always check (for signing/privileged operations)
 * @returns true if IdP check is needed
 */
export function shouldCheckIdp(user: SessionUser, forceFresh = false): boolean {
  if (forceFresh) return true
  
  const lastCheck = user.lastIdpCheck
  if (!lastCheck) return true // Never checked
  
  const now = Math.floor(Date.now() / 1000)
  const elapsed = now - lastCheck
  
  return elapsed >= FIVE_MINUTES
}

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
 * Verifies that a user is enabled in the IdP and updates lastIdpCheck.
 * 
 * @param user - The session user
 * @param forceFresh - Always check (for signing/privileged operations)
 * @returns Updated user with new lastIdpCheck, or null if disabled/error
 */
export async function verifyIdpAccess(
  user: SessionUser,
  forceFresh = false
): Promise<SessionUser | null> {
  // Check if we need to perform IdP check
  if (!shouldCheckIdp(user, forceFresh)) {
    return user // Access OK, no check needed
  }
  
  try {
    const status = await checkUserIdpStatus(user)
    
    // Update lastIdpCheck timestamp
    const now = Math.floor(Date.now() / 1000)
    const updatedUser: SessionUser = {
      ...user,
      lastIdpCheck: now,
    }
    
    // Check if user is disabled
    if (status === 'disabled') {
      return null // Access denied
    }
    
    // Check if user is missing (should not happen for existing session)
    if (status === 'missing') {
      return null // Access denied
    }
    
    // User is enabled
    return updatedUser
  } catch (error) {
    // IdP unreachable - deny access (no cache fallback)
    return null
  }
}
