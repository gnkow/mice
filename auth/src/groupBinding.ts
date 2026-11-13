/**
 * Group bindings use IdP object ids: `iss|group_id`. Display names are cached
 * separately and never used as grant keys when an id is available.
 */
import { canonicalIssuer } from './authentication/session/principal.js'

const OBJECT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isGroupObjectId(value: string): boolean {
  return OBJECT_ID.test(value.trim())
}

/** Canonical grant key for a group in one IdP. */
export function groupBindingKey(iss: string, groupId: string): string {
  return `${canonicalIssuer(iss)}|${groupId.trim()}`
}

export function parseGroupBindingKey(
  key: string,
): { iss: string; groupId: string } | null {
  const i = key.indexOf('|')
  if (i <= 0 || i === key.length - 1) return null
  return { iss: key.slice(0, i), groupId: key.slice(i + 1) }
}

export type ExtractedGroup = {
  bindingKey: string
  groupId: string
  displayName: string
  /** False when the claim was a display name used as a fallback id. */
  idBased: boolean
}

export type ExtractGroupsResult = {
  groups: ExtractedGroup[]
  /** True when any claim lacked an object id and fell back to a normalized name. */
  nameBasedFallback: boolean
}

/**
 * Single claim → binding seam: UUID object ids are id-based; anything else is a
 * name fallback. An already-keyed `iss|group_id` is re-keyed from the key's issuer.
 */
export function resolveGroupClaim(iss: string, claim: string): ExtractedGroup {
  const existing = parseGroupBindingKey(claim)
  if (existing) {
    const idBased = isGroupObjectId(existing.groupId)
    const groupId = existing.groupId
    return {
      bindingKey: groupBindingKey(existing.iss, groupId),
      groupId,
      displayName: groupId,
      idBased,
    }
  }
  const trimmed = claim.trim()
  const idBased = isGroupObjectId(trimmed)
  const groupId = trimmed.toLowerCase()
  return {
    bindingKey: groupBindingKey(iss, groupId),
    groupId,
    displayName: idBased ? groupId : trimmed,
    idBased,
  }
}

/**
 * Turn a bare IdP group id/name (or an existing binding key) into the stored grant key.
 * Name-shaped values are normalized; UUID object ids keep lowercase hex.
 */
export function toGroupBindingKey(iss: string, group: string): {
  bindingKey: string
  groupId: string
  idBased: boolean
} {
  const resolved = resolveGroupClaim(iss, group)
  return {
    bindingKey: resolved.bindingKey,
    groupId: resolved.groupId,
    idBased: resolved.idBased,
  }
}

function claimList(raw: unknown): string[] {
  if (typeof raw === 'string') return [raw]
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is string => typeof item === 'string')
}

/**
 * Turn an IdP groups claim into binding keys.
 * UUID-shaped values (Azure AD / typical Keycloak ids) are id-based; anything
 * else is a name fallback (normalized) with `nameBasedFallback`.
 */
export function extractGroupsFromClaims(
  raw: unknown,
  opts: { issuer: string },
): ExtractGroupsResult {
  const iss = canonicalIssuer(opts.issuer)
  const groups: ExtractedGroup[] = []
  const seen = new Set<string>()
  let nameBasedFallback = false

  for (const item of claimList(raw)) {
    const trimmed = item.trim()
    if (!trimmed) continue
    const resolved = resolveGroupClaim(iss, trimmed)
    if (!resolved.idBased) nameBasedFallback = true
    if (seen.has(resolved.bindingKey)) continue
    seen.add(resolved.bindingKey)
    groups.push(resolved)
  }

  return { groups, nameBasedFallback }
}
