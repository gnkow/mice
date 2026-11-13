import { groupBindingKey } from '../../groupBinding.js'
import type { Directory } from '../directory/directoryTypes.js'
import type { OidcClaims } from './oidcClaims.js'

/**
 * Group Overage Handling (Ticket 18, Round 8 U17)
 *
 * When an IdP returns a group overage indicator (user has too many groups
 * to fit in the id_token), fetch groups from the directory API instead
 * of failing login.
 *
 * Entra ID sends `_claim_names.groups` when overage occurs. This module
 * fetches the full group list from the directory and binds them for the session.
 */

export type DirectoryGroupFetch =
  | { ok: true; groups: string[] }
  | { ok: false; reason: 'unconfigured' | 'empty' | 'error' }

/**
 * Fetch group binding keys from the directory for an overage claim.
 * Package seam for configure / empty / error paths; login adapts via
 * `resolveGroupOverage`.
 */
export async function fetchDirectoryGroupBindings(
  claims: OidcClaims,
  directory: Directory,
): Promise<DirectoryGroupFetch> {
  if (!directory.configured) {
    console.error(
      '[mice-auth] Group overage detected but directory not configured. Login will fail.',
    )
    return { ok: false, reason: 'unconfigured' }
  }

  if (directory.issuer !== claims.iss) {
    console.warn(
      `[mice-auth] Directory issuer (${directory.issuer}) does not match claims issuer (${claims.iss}). ` +
        'Group fetch may fail or return incorrect groups.',
    )
  }

  try {
    const iss = directory.issuer || claims.iss
    const groups = (await directory.getUserGroups(claims.sub))
      .map((group) => group.id)
      .filter((id) => id.length > 0)
      .map((id) => groupBindingKey(iss, id))

    if (groups.length === 0) {
      console.warn(
        `[mice-auth] Group overage for user ${claims.sub} but directory returned no groups. ` +
          'User may have lost group memberships or directory fetch failed.',
      )
      return { ok: false, reason: 'empty' }
    }

    console.info(
      `[mice-auth] Fetched ${groups.length} groups from directory for user ${claims.sub} (overage recovery)`,
    )
    return { ok: true, groups }
  } catch (error) {
    console.error(
      `[mice-auth] Failed to fetch groups from directory for user ${claims.sub}:`,
      error instanceof Error ? error.message : String(error),
    )
    return { ok: false, reason: 'error' }
  }
}

/**
 * Fetch groups from directory API when IdP indicates overage.
 * Returns populated groups array on success, empty array on failure / no overage path
 * that leaves existing claims groups when overage is not set.
 *
 * Prefer `resolveGroupOverage` at the login seam.
 */
export async function fetchGroupsOnOverage(
  claims: OidcClaims,
  directory: Directory,
): Promise<string[]> {
  if (!claims.groupsOverage) {
    return claims.groups
  }
  const fetched = await fetchDirectoryGroupBindings(claims, directory)
  return fetched.ok ? fetched.groups : []
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
    return true
  }

  const fetched = await fetchDirectoryGroupBindings(claims, directory)
  if (!fetched.ok) {
    return false
  }

  claims.groups = fetched.groups
  delete claims.groupsOverage
  return true
}
