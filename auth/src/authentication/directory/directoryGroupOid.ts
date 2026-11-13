import { normalizeGroup } from '../../authzTypes.js'
import { isGroupObjectId } from '../../groupBinding.js'
import type { DirectoryGroup, DirectoryGroupHit } from './directoryTypes.js'

type KeycloakGroupRow = { id?: string; name?: string; path?: string }

/**
 * Map a Keycloak Admin group row to a directory hit.
 * Object id is the grant key (lowercased UUID); without an id, the normalized leaf name stays the key.
 */
export function mapKeycloakGroupRow(g: KeycloakGroupRow): DirectoryGroupHit | null {
  const leaf = (g.name || g.path || '').replace(/^\//, '').split('/').pop() ?? ''
  const display = (g.name || leaf).trim()
  const rawId = g.id?.trim()
  if (rawId) {
    const group = isGroupObjectId(rawId) ? rawId.toLowerCase() : rawId
    return { kind: 'group', group, name: display || group }
  }
  const name = normalizeGroup(leaf)
  if (!name) return null
  return { kind: 'group', group: name, name }
}

/** Directory membership / lookup shape from a Keycloak group row. */
export function mapKeycloakDirectoryGroup(g: KeycloakGroupRow): DirectoryGroup | null {
  const hit = mapKeycloakGroupRow(g)
  return hit ? { id: hit.group, name: hit.name } : null
}
