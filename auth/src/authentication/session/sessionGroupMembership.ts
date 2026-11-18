/**
 * Session IdP group membership for Profile (/auth/me).
 *
 * Binding keys stay the stable id; display names come from the cache filled at login
 * (or refreshed from the directory via POST /auth/me/groups/refresh).
 */

import { groupBindingKey, parseGroupBindingKey } from '../../groupBinding.js'
import { getGroupDisplayNames, upsertGroupDisplayNames } from '../../groupDisplayStore.js'
import type { Directory } from '../directory/directoryTypes.js'

export type SessionGroupMembership = {
  bindingKey: string
  displayName: string
}

export type DirectoryGroupsFetch =
  | { ok: true; bindingKeys: string[] }
  | { ok: false; reason: 'unconfigured' | 'error' }

/**
 * Map session binding keys to display rows. Pure: display map is injected so
 * unit tests do not need the store.
 */
export function formatSessionGroupMembership(
  groups: string[] | undefined,
  display: Map<string, { displayName: string; idBased: boolean }>,
): SessionGroupMembership[] {
  const keys = groups ?? []
  return keys
    .map((bindingKey) => {
      const cached = display.get(bindingKey)
      const parsed = parseGroupBindingKey(bindingKey)
      return {
        bindingKey,
        displayName: cached?.displayName ?? parsed?.groupId ?? bindingKey,
      }
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }))
}

/** Load display names for the caller's session groups. */
export async function loadSessionGroupMembership(
  groups: string[] | undefined,
): Promise<SessionGroupMembership[]> {
  const keys = groups ?? []
  if (!keys.length) return []
  return formatSessionGroupMembership(keys, await getGroupDisplayNames(keys))
}

/**
 * Fetch the Principal's current directory groups and refresh the display-name cache.
 * Used by Profile "Refresh groups" — directory is the live source of truth.
 */
export async function fetchDirectoryGroupsForSession(
  session: { sub: string; iss: string },
  directory: Directory,
): Promise<DirectoryGroupsFetch> {
  if (!directory.configured) {
    return { ok: false, reason: 'unconfigured' }
  }
  try {
    const listed = await directory.getUserGroups(session.sub)
    const dirIss = directory.issuer || session.iss
    const bindingKeys: string[] = []
    const cacheRows: Array<{ bindingKey: string; displayName: string; idBased: boolean }> = []
    for (const group of listed) {
      if (!group.id) continue
      const bindingKey = groupBindingKey(dirIss, group.id)
      bindingKeys.push(bindingKey)
      cacheRows.push({
        bindingKey,
        displayName: group.name || group.id,
        idBased: true,
      })
    }
    if (cacheRows.length) await upsertGroupDisplayNames(cacheRows)
    return { ok: true, bindingKeys }
  } catch (err) {
    console.error(
      `[mice-auth] Directory group refresh failed for ${session.sub}:`,
      err instanceof Error ? err.message : String(err),
    )
    return { ok: false, reason: 'error' }
  }
}
