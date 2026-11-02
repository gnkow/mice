import type { Directory } from '../directory/directoryTypes.js'
import type { OidcClaims } from './oidcClaims.js'

/**
 * Group Overage Handling (Ticket 18, Round 8 U17)
 * 
 * When an IdP returns a group overage indicator (user has too many groups
 * to fit in the id_token), fetch groups from the directory API instead
 * of failing login.
 * 
 * Entra ID sends `_claim_names.groups` when overage occurs. This function
 * fetches the full group list from Microsoft Graph (or equivalent directory API).
 */

/**
 * Fetch groups from directory API when IdP indicates overage.
 * Returns populated groups array on success, empty array on failure.
 * 
 * Only call this when claims.groupsOverage === true.
 */
export async function fetchGroupsOnOverage(
  claims: OidcClaims,
  directory: Directory,
): Promise<string[]> {
  // Only fetch if overage was detected
  if (!claims.groupsOverage) {
    return claims.groups
  }

  // Directory must be configured to fetch groups
  if (!directory.configured) {
    console.error('[mice-auth] Group overage detected but directory not configured. Login will fail.')
    return []
  }

  // Verify directory issuer matches claims issuer
  if (directory.issuer !== claims.iss) {
    console.warn(
      `[mice-auth] Directory issuer (${directory.issuer}) does not match claims issuer (${claims.iss}). ` +
      'Group fetch may fail or return incorrect groups.'
    )
  }

  // Fetch groups from directory API
  try {
    const groups = (await directory.getUserGroups(claims.sub)).map((group) => group.id)
    
    if (groups.length === 0) {
      console.warn(
        `[mice-auth] Group overage for user ${claims.sub} but directory returned no groups. ` +
        'User may have lost group memberships or directory fetch failed.'
      )
    } else {
      console.info(
        `[mice-auth] Fetched ${groups.length} groups from directory for user ${claims.sub} (overage recovery)`
      )
    }
    
    return groups
  } catch (error) {
    console.error(
      `[mice-auth] Failed to fetch groups from directory for user ${claims.sub}:`,
      error instanceof Error ? error.message : String(error)
    )
    return []
  }
}

/**
 * Complete the claims by fetching groups if overage was detected.
 * Modifies claims.groups in place and removes the groupsOverage flag.
 * 
 * Returns true if groups were successfully populated (or no overage),
 * false if overage was detected but groups could not be fetched.
 */
export async function resolveGroupOverage(
  claims: OidcClaims,
  directory: Directory,
): Promise<boolean> {
  if (!claims.groupsOverage) {
    // No overage, groups are already in claims
    return true
  }

  const groups = await fetchGroupsOnOverage(claims, directory)
  
  if (groups.length === 0) {
    // Overage detected but couldn't fetch groups
    return false
  }

  // Update claims with fetched groups
  claims.groups = groups
  delete claims.groupsOverage

  return true
}
