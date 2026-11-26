/**
 * Group bindings use IdP object ids only: `iss|group_id`.
 * Display names are cached separately and are never grant keys.
 * Name-based grants are not allowed.
 */
import { canonicalIssuer } from '../../authentication/principal.js'

const OBJECT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const GROUP_OBJECT_ID_REQUIRED =
  'Group grants require an IdP object id (UUID), not a display name.'

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
  /** False when the claim was a display name (never stored as a grant). */
  idBased: boolean
}

export type ExtractGroupsResult = {
  groups: ExtractedGroup[]
  /** True when any claim lacked an object id and was dropped. */
  nameBasedFallback: boolean
}

export type IdBasedGroupBinding =
  | { ok: true; bindingKey: string; groupId: string }
  | { ok: false; error: string }

/**
 * Single claim → binding seam. UUID object ids are id-based; anything else is
 * marked non-id (callers must not grant on those). An already-keyed
 * `iss|group_id` is re-keyed from the key's issuer.
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
 * Turn a bare IdP group id (or an existing binding key) into the stored grant key.
 * Prefer `requireIdBasedGroupBinding` at grant write seams.
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

/** Grant write seam: refuse anything that is not an IdP object id. */
export function requireIdBasedGroupBinding(
  iss: string,
  group: string,
): IdBasedGroupBinding {
  if (!group.trim()) {
    return { ok: false, error: 'Group id required' }
  }
  const resolved = resolveGroupClaim(iss, group)
  if (!resolved.idBased) {
    return { ok: false, error: GROUP_OBJECT_ID_REQUIRED }
  }
  return {
    ok: true,
    bindingKey: resolved.bindingKey,
    groupId: resolved.groupId,
  }
}

function claimList(raw: unknown): string[] {
  if (typeof raw === 'string') return [raw]
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is string => typeof item === 'string')
}

/**
 * Turn an IdP groups claim into binding keys.
 * Only UUID object ids are kept; display-name claims are dropped
 * (`nameBasedFallback` records that the token had non-id values).
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
    if (!resolved.idBased) {
      nameBasedFallback = true
      continue
    }
    if (seen.has(resolved.bindingKey)) continue
    seen.add(resolved.bindingKey)
    groups.push(resolved)
  }

  return { groups, nameBasedFallback }
}
