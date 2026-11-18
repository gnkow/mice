/** Parse an IdP group binding key stamped as `iss|group_id`. */
export function parseGroupBindingKey(
  bindingKey: string,
): { iss: string; groupId: string } | null {
  const trimmed = bindingKey.trim()
  const bar = trimmed.indexOf('|')
  if (bar <= 0 || bar === trimmed.length - 1) return null
  return { iss: trimmed.slice(0, bar), groupId: trimmed.slice(bar + 1) }
}

/**
 * Compact label for a group reference: display name, else a short group id,
 * else the raw binding key.
 */
export function decideGroupRefLabel(input: {
  bindingKey: string
  displayName?: string | null
}): string {
  const name = input.displayName?.trim()
  if (name) return name
  const parsed = parseGroupBindingKey(input.bindingKey)
  if (parsed) {
    return parsed.groupId.length > 12
      ? `${parsed.groupId.slice(0, 8)}…`
      : parsed.groupId
  }
  const raw = input.bindingKey.trim()
  return raw || 'unknown'
}

/** Whether a group matches a free-text search (name or id). */
export function groupMatchesSearch(
  group: { bindingKey: string; displayName: string },
  query: string,
): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const parsed = parseGroupBindingKey(group.bindingKey)
  return (
    group.displayName.toLowerCase().includes(q) ||
    group.bindingKey.toLowerCase().includes(q) ||
    (parsed?.groupId.toLowerCase().includes(q) ?? false)
  )
}
