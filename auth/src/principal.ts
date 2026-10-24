/**
 * Principal identity: the single place that knows how a Principal is keyed and matched
 * (ADR 0001). A Principal is an IdP `iss`+`sub`; email counts only when verified.
 */
export type PrincipalId = { sub: string; iss: string }

const SEP = '\0'
const norm = (v: string) => v.trim().replace(/\/$/, '')

/** Canonical storage key for a Principal. */
export function principalKey(p: PrincipalId): string {
  return `${p.iss}${SEP}${p.sub}`
}

export function parsePrincipalKey(key: string): PrincipalId {
  const i = key.indexOf(SEP)
  if (i < 0) return { iss: '', sub: key }
  return { iss: key.slice(0, i), sub: key.slice(i + 1) }
}

/** A pre-`iss`+`sub` key: a bare `sub` with no issuer. */
export function isLegacyPrincipalKey(k: unknown): k is string {
  return typeof k === 'string' && k !== '' && !k.includes(SEP)
}

/** Attribute a legacy bare-`sub` key to `issuer`. */
export function qualifyLegacyKey(issuer: string, legacyKey: string): string {
  return principalKey({ iss: issuer, sub: legacyKey })
}

/**
 * Match a bootstrap list entry against a Principal. Entries are either `<iss>|<sub>` or an
 * email; an email matches only when the IdP asserted `email_verified`. A bare `sub`, or the
 * synthetic `<sub>@users.local` fallback, never matches.
 */
export function matchesIdentityEntry(
  entry: string,
  user: PrincipalId & { email: string; emailVerified?: boolean },
): boolean {
  const e = entry.trim()
  if (!e) return false
  const bar = e.lastIndexOf('|')
  if (bar >= 0) {
    return norm(e.slice(0, bar)) === norm(user.iss) && e.slice(bar + 1) === user.sub
  }
  if (!e.includes('@')) return false
  const email = user.email.toLowerCase()
  if (email.endsWith('@users.local')) return false
  return user.emailVerified === true && e.toLowerCase() === email
}
