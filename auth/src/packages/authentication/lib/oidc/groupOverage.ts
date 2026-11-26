import { groupBindingKey } from '../../../authz/types.js'
import { isGroupObjectId } from '../../../authz/types.js'
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
      .map((group) => group.id.trim())
      .filter((id) => isGroupObjectId(id))
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
 * Outcome of resolving IdP group overage into session-ready claims.
 * Does not mutate the input; success returns a new claims object.
 */
export type GroupOverageResolution =
  | { ok: true; claims: OidcClaims }
  | { ok: false; reason: 'unconfigured' | 'empty' | 'error' }

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
  const resolved = await resolveGroupOverage(claims, directory)
  return resolved.ok ? resolved.claims.groups : []
}

/**
 * Complete claims by fetching groups when overage was detected.
 * Returns a typed resolution: success carries claims with bound groups and
 * no overage flag; failure carries the directory-fetch reason. Input is unchanged.
 */
export async function resolveGroupOverage(
  claims: OidcClaims,
  directory: Directory,
): Promise<GroupOverageResolution> {
  if (!claims.groupsOverage) {
    return { ok: true, claims }
  }

  const fetched = await fetchDirectoryGroupBindings(claims, directory)
  if (!fetched.ok) {
    return { ok: false, reason: fetched.reason }
  }

  const { groupsOverage: _cleared, ...rest } = claims
  return { ok: true, claims: { ...rest, groups: fetched.groups } }
}
