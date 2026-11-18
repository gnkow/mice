/**
 * Parse a Principal stamped as `iss|sub` (commit author) or `iss\u001fsub`
 * (AuthZ storage / seat history keys).
 */
export function parsePrincipalAuthor(
  author: string,
): { iss: string; sub: string } | null {
  const trimmed = author.trim()
  const us = trimmed.indexOf('\u001f')
  if (us > 0 && us < trimmed.length - 1) {
    return { iss: trimmed.slice(0, us), sub: trimmed.slice(us + 1) }
  }
  const bar = trimmed.indexOf('|')
  if (bar <= 0 || bar === trimmed.length - 1) return null
  return { iss: trimmed.slice(0, bar), sub: trimmed.slice(bar + 1) }
}

/** Canonical display / profile lookup key (`iss|sub`). */
export function toAuthorKey(author: string): string {
  const parsed = parsePrincipalAuthor(author)
  return parsed ? `${parsed.iss}|${parsed.sub}` : author.trim()
}

/** Email local-part used as a username when no IdP username is available. */
export function usernameFromEmail(email: string | null | undefined): string | null {
  const trimmed = email?.trim()
  if (!trimmed?.includes('@')) return null
  const local = trimmed.slice(0, trimmed.indexOf('@')).trim()
  return local || null
}

/**
 * Compact label for a user reference: display name, else email local-part,
 * else a short Principal sub, else the raw author.
 */
export function decideUserRefLabel(input: {
  author: string
  name?: string | null
  email?: string | null
}): string {
  const name = input.name?.trim()
  if (name) return name
  const fromEmail = usernameFromEmail(input.email)
  if (fromEmail) return fromEmail
  const parsed = parsePrincipalAuthor(input.author)
  if (parsed) {
    return parsed.sub.length > 12 ? `${parsed.sub.slice(0, 8)}…` : parsed.sub
  }
  const raw = input.author.trim()
  return raw || 'unknown'
}

/** Username shown in UserInfo (email local-part, else short sub). */
export function decideUserRefUsername(input: {
  author: string
  email?: string | null
}): string | null {
  const fromEmail = usernameFromEmail(input.email)
  if (fromEmail) return fromEmail
  const parsed = parsePrincipalAuthor(input.author)
  if (parsed) {
    return parsed.sub.length > 12 ? `${parsed.sub.slice(0, 8)}…` : parsed.sub
  }
  return null
}
