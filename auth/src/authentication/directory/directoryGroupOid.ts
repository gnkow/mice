import { isGroupObjectId } from '../../groupBinding.js'
import type { DirectoryGroup, DirectoryGroupHit } from './directoryTypes.js'

type KeycloakGroupRow = { id?: string; name?: string; path?: string }

/**
 * Grant key for a Keycloak group object id.
 * UUID object ids are lowercased so grants match case-insensitive IdP ids.
 * Display names are never grant keys.
 */
export function directoryGroupGrantKey(rawIdOrName: string): string {
  const trimmed = rawIdOrName.trim()
  if (!trimmed || !isGroupObjectId(trimmed)) return ''
  return trimmed.toLowerCase()
}

/**
 * Map a Keycloak Admin group row to a directory hit.
 * Object id is the only grant key; rows without a UUID id are skipped.
 */
export function mapKeycloakGroupRow(g: KeycloakGroupRow): DirectoryGroupHit | null {
  const leaf = (g.name || g.path || '').replace(/^\//, '').split('/').pop() ?? ''
  const display = (g.name || leaf).trim()
  const group = directoryGroupGrantKey(g.id ?? '')
  if (!group) return null
  return { kind: 'group', group, name: display || group }
}

/** Directory membership / lookup shape from a Keycloak group row. */
export function mapKeycloakDirectoryGroup(g: KeycloakGroupRow): DirectoryGroup | null {
  const hit = mapKeycloakGroupRow(g)
  return hit ? { id: hit.group, name: hit.name } : null
}
